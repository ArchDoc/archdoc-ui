import React from 'react';
import { ArchDocComponent, ArchDocModel } from '../../models/ArchdocModel2';
import { computeGraphRanking } from './ArchdocGraph';

describe('my test module', () => {
    test.each([1,2,3])('%i < 10', (n) => {
        expect(n).toBeLessThan(10);
    });
});

const generateArchDocComponent = (name: string, type: string, consumers: string[], dependencies: string[]): ArchDocComponent => ({
    name,
    type,
    description: "",
    repository: "",
    tags: [],
    consumers: consumers.map(c => ({ componentId: c, description: "" })),
    dependencies: dependencies.map(d => ({ componentId: d, description: "" })),
    documentation: ""
});

describe('computeGraphRanking()', () => {
    test("should be able to rank an empty model", () => {
        const archdocModel: ArchDocModel = []

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([])
    });

    test("should be able to rank U1", () => {
        const archdocModel: ArchDocModel = [
            generateArchDocComponent("U1", "user", [], [])
        ]

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([["U1"]])
    });

    test("should be able to rank U1 -> S1 -> S2", () => {
        const archdocModel: ArchDocModel = [
            generateArchDocComponent("U1", "user", [], ["S1"]),
            generateArchDocComponent("S1", "service", ["U1"], ["S2"]),
            generateArchDocComponent("S2", "service", ["S1"], [])
        ]

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([["U1"],["S1"],["S2"]])
    });

    test("should be able to rank U1 -> S1 -> S2 -> S3", () => {
        const archdocModel: ArchDocModel = [
            generateArchDocComponent("U1", "user", [], ["S1"]),
            generateArchDocComponent("S1", "service", ["U1"], ["S2"]),
            generateArchDocComponent("S2", "service", ["S1"], ["S3"]),
            generateArchDocComponent("S3", "service", ["S2"], []),
        ]

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([["U1"],["S1"],["S2"],["S3"]])
    });

    test("should be able to rank A -> B -> (C -> E, D -> F)", () => {
        const archdocModel: ArchDocModel = [
            generateArchDocComponent("U1", "user", [], ["S1"]),
            generateArchDocComponent("S1", "service", ["U1"], ["S2", "S3"]),
            generateArchDocComponent("S2", "service", ["S1"], ["S4"]),
            generateArchDocComponent("S3", "service", ["S1"], ["S5"]),
            generateArchDocComponent("S4", "service", ["S2"], []),
            generateArchDocComponent("S5", "service", ["S3"], []),
        ]

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([["U1"],["S1"],["S2","S3"],["S4","S5"]])
    });

    test("should be able to rank U1 -> (S1, S2, S3, S4)", () => {
        const archdocModel: ArchDocModel = [
            generateArchDocComponent("U1", "user", [], ["S1", "S2", "S3", "S4"]),
            generateArchDocComponent("S1", "service", ["U1"], []),
            generateArchDocComponent("S2", "service", ["U1"], []),
            generateArchDocComponent("S3", "service", ["U1"], []),
            generateArchDocComponent("S4", "service", ["U1"], []),
        ]

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([["U1"],["S1","S2","S3","S4"]])
    });

    test("should be able to rank U1 -> (S1 -> S4, S2 -> S4, S3 -> S4)", () => {
        const archdocModel: ArchDocModel = [
            generateArchDocComponent("U1", "user", [], ["S1","S2","S3"]),
            generateArchDocComponent("S1", "service", ["U1"], ["S4"]),
            generateArchDocComponent("S2", "service", ["U1"], ["S4"]),
            generateArchDocComponent("S3", "service", ["U1"], ["S4"]),
            generateArchDocComponent("S4", "service", ["S1","S2","S3"], []),
        ]

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([["U1"],["S1","S2","S3"],["S4"]])
    });

    test("should be able to rank (U1 -> S1, U2 -> S1) -> S2", () => {
        const archdocModel: ArchDocModel = [
            generateArchDocComponent("U1", "user", [], ["S1"]),
            generateArchDocComponent("U2", "user", [], ["S1"]),
            generateArchDocComponent("S1", "service", ["U1","U2"], ["S2"]),
            generateArchDocComponent("S2", "service", ["S1"], [])
        ]

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([["U1","U2"],["S1"],["S2"]])
    });

    test("should be able to rank (U1 -> S1 -> S2, U2 -> S2)", () => {
        const archdocModel: ArchDocModel = [
            generateArchDocComponent("U1", "user", [], ["S1"]),
            generateArchDocComponent("U2", "user", [], ["S2"]),
            generateArchDocComponent("S1", "service", ["U1"], ["S2"]),
            generateArchDocComponent("S2", "service", ["U2","S1"], [])
        ]

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([["U1","U2"],["S1","S2"]])
    });

    test("should be able to rank U1 -> S1 -> S2 -> (S3, S4, S5)", () => {
        const archdocModel: ArchDocModel = [
            generateArchDocComponent("U1", "user", [], ["S1"]),
            generateArchDocComponent("S1", "service", ["U1"], ["S2"]),
            generateArchDocComponent("S2", "service", ["S1"], ["S3","S4","S5"]),
            generateArchDocComponent("S3", "service", ["S2"], []),
            generateArchDocComponent("S4", "service", ["S2"], []),
            generateArchDocComponent("S5", "service", ["S2"], [])
        ]

        const graphRanking = computeGraphRanking(archdocModel);

        expect(graphRanking).toStrictEqual([["U1"],["S1"],["S2"],["S3","S4","S5"]])
    });
});