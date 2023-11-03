# ArchDoc UI
ArchDoc UI allows users to define and visualize software systems. With ArchDoc UI, you can increase transparency and clarity of your organization's architecture. **Don't diagram your architecture. Model it.**

![archdoc demo](docs/archdoc-demo.gif "ArchDoc Demo Video")

## Why ArchDoc?

ArchDoc UI is designed to tackle the problem of miscommunication between developers, architects, and other stakeholders in software development projects. With ArchDoc, you can define and visualize software models, which helps the whole team to know the components, components, and clients of your organization's software system..

## Features

 - **Intuitive Diagrams**: ArchDoc UI arranges your organization's architecture in a clear, easy-to-understand graph. Powered by [React Flow](https://reactflow.dev/).
 - **Easy-to-use**: No need to learn a new diagram-as-code DSL, simply create a YAML file and use the `archdoc` cli tool to visualize it.
 - **Embedded Documentation**: Define and read documentation for your components, while exploring your architecture.
 - **Open-source**: By the people, for the people.

## Getting Started
To get started with ArchDoc UI, you need to have Node.js v16 installed on your machine. Then, simply run the following command to install ArchDoc globally:

```bash
npm i -g @archdoc/archdoc-ui
```

Next, create an ArchDoc Spec file, following the documentation outlined in the [ArchDoc Documentation](https://github.com/ArchDoc/archdoc-ui/wiki/ArchDoc-Documentation).

After the installation, you can run ArchDoc UI to visualize your ArchDoc Spec file:

```bash
archdoc myarchitecture.yaml
```

## Contributing
If you're interested in contributing to the ArchDoc UI project, we welcome your contributions! Here are a few ways you can get involved:

 - Report bugs and request features using the GitHub issue tracker.
 - Submit pull requests for bug fixes and new features.
 - Help with documentation and sample projects.
 - Share ArchDoc UI with others in the software development community.

To get started, simply fork the repository and submit a pull request with your changes. Thank you for your support!
