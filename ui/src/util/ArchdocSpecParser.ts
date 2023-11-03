import { ArchDocComponent, ArchDocModel, ArchDocDependency } from "../models/ArchdocModel2";
import YAML from 'yaml'
import Ajv from 'ajv';
import { ArchdocSpec, ArchdocSpecSchema } from "../models/ArchdocSpec";

const ajv = new Ajv({code: {es5: true}});

export class ArchdocSpecParser {
    constructor() {

    }

    parse(contents: string): ArchDocModel {
        const spec = YAML.parse(contents);

        console.log("SPEC");
        console.log(spec);

        const validate = ajv.compile(ArchdocSpecSchema);

        let archdocSpec = null;

        if (validate(spec)) {
            archdocSpec = <ArchdocSpec> spec;
        } else {
            console.log(validate.errors);
            console.error("AHH!!!");
            
            let errorMessage = `Unknown error`;

            if (validate.errors && validate.errors.length > 0) {
                const myError = validate.errors[0];

                errorMessage = `parsing ${myError.keyword} error: ${myError.instancePath} ${myError.message} (${Object.values(myError.params)[0]})`
            }

            throw new Error(errorMessage);
        }

        if (archdocSpec === null) {
            return []//throw new Error("BAD!!!");
        }

        interface DependencyMapping {
            source: string,
            target: string,
            description: string
        }

        const depedencyList: DependencyMapping[] = [];

        const definedServiceNames = Object.keys(archdocSpec.components);

        const userComponents: ArchDocComponent[] = Object.entries(archdocSpec.users)
            .map(([name, componentSpec]): ArchDocComponent => {
                const { 
                    description, 
                    tags, 
                    repository, 
                    documentation 
                } = componentSpec;

                const dependencies = Object.entries(componentSpec.dependencies)
                    .map(([name, description]): ArchDocDependency  => ({
                        componentId: name,
                        description
                    }));

                const invalidDependencies = dependencies.filter(d => !definedServiceNames.includes(d.componentId))
                if (invalidDependencies.length > 0) {
                    throw new Error(`Model Error: User ${name} has a dependency on a service (${invalidDependencies[0].componentId}) that doesn't exist.`)
                }

                dependencies.forEach(value => {
                    depedencyList.push({
                        source: name,
                        target: value.componentId,
                        description: value.description
                    })
                });
            
                return {
                    name,
                    type: "user",
                    description,
                    tags,
                    repository,
                    consumers: [],
                    dependencies,
                    documentation
                }
            });

        const serviceComponents: ArchDocComponent[] = Object.entries(archdocSpec.components)
            .map(([name, componentSpec]): ArchDocComponent => {
                const { 
                    description, 
                    tags, 
                    repository, 
                    documentation 
                } = componentSpec;

                if (!componentSpec.dependencies) {
                    componentSpec.dependencies = {};
                }

                const dependencies = Object.entries(componentSpec.dependencies)
                    .map(([name, description]): ArchDocDependency  => ({
                        componentId: name,
                        description
                    }));

                const invalidDependencies = dependencies.filter(d => !definedServiceNames.includes(d.componentId))
                if (invalidDependencies.length > 0) {
                    throw new Error(`Model Error: Service ${name} has a dependency on a service (${invalidDependencies[0].componentId}) that doesn't exist.`)
                }

                dependencies.forEach(value => {
                    depedencyList.push({
                        source: name,
                        target: value.componentId,
                        description: value.description
                    })
                });
            
                return {
                    name,
                    type: "service",
                    description,
                    tags,
                    repository,
                    consumers: [],
                    dependencies,
                    documentation
                }
            });

        const updatedServiceComponents = serviceComponents.map((component): ArchDocComponent => {
            const updatedConsumers = depedencyList.filter(dep => dep.target === component.name)
                .map((dep): ArchDocDependency => ({
                    componentId: dep.source,
                    description: dep.description
                }));

            const { consumers, ...restOfComponent } = component;

            return {
                consumers: updatedConsumers,
                ...restOfComponent
            }
        });

        const archdocModel: ArchDocModel = [
            ...userComponents,
            ...updatedServiceComponents
        ]

        console.log("MODEL");
        console.log(depedencyList);
        console.log(archdocModel);

        return archdocModel;
    }
}