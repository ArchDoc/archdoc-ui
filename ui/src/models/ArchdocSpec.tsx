import { JSONSchemaType } from "ajv";


export interface ArchdocComponentSpec {
    description: string
    tags: string[]
    repository: string
    dependencies: Record<string, string>
    documentation: string
}

export interface ArchdocSpec {
    archdoc: string
    users: Record<string, ArchdocComponentSpec>
    components: Record<string, ArchdocComponentSpec>
}

export const ArchdocSpecSchema: JSONSchemaType<ArchdocSpec> = {
    type: "object",
    properties: {
        archdoc: {type: "string"},
        users: {
            type: "object",
            patternProperties: {
                "^.*$": {
                    type: "object",
                    properties: {
                        description: {type: 'string'},
                        tags: {
                            type: "array",
                            items: {
                                type: "string"
                            }
                        },
                        repository: {type: 'string'},
                        dependencies: {
                            type: "object",
                            patternProperties: {
                                "^.*$": {type: 'string'}
                            },
                            required: [],
                            additionalProperties: false
                        },
                        documentation: {type: 'string'},
                    },
                    required: [],
                    additionalProperties: false
                }
            },
            required: [],
            additionalProperties: false
        },
        components: {
            type: "object",
            patternProperties: {
                "^.*$": {
                    type: "object",
                    properties: {
                        description: {type: 'string'},
                        tags: {
                            type: "array",
                            items: {
                                type: "string"
                            }
                        },
                        repository: {type: 'string'},
                        dependencies: {
                            type: "object",
                            patternProperties: {
                                "^.*$": {type: 'string'}
                            },
                            required: [],
                            additionalProperties: false
                        },
                        documentation: {type: 'string'},
                    },
                    required: [],
                    additionalProperties: false
                }
            },
            required: [],
            additionalProperties: false
        },
    },
    required: ["archdoc", "users", "components"],
    additionalProperties: false,
}