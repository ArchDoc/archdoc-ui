export interface ArchDocTag {
    name: string,
    color: string
}

export interface ArchDocDependency {
    sourceId: string
    targetId: string
    description: string
}

export interface ArchDocComponent {
    name: string
    description: string | null
    tags: string[]
    repository: string | null
    consumers: ArchDocDependency[]
    dependencies: ArchDocDependency[]
    documentation: string | null
}

export type ArchDocModel = ArchDocComponent[];