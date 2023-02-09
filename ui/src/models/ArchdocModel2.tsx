export interface ArchDocTag {
    name: string,
    color: string
}

export interface ArchDocDependency {
    componentId: string
    description: string
}

export interface ArchDocComponent {
    name: string
    type: string
    description: string | null
    tags: string[]
    repository: string | null
    consumers: ArchDocDependency[]
    dependencies: ArchDocDependency[]
    documentation: string | null
}

export type ArchDocModel = ArchDocComponent[];