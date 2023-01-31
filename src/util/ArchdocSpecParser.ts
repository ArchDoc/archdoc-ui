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

        const serviceComponents: ArchDocComponent[] = Object.entries(archdocSpec.services)
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