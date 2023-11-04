export const simpleArch = `
archdoc: 0.1.0

users:
  client:
    description: "The user of the application"
    tags:
      - "my"
      - "user"
    dependencies:
      ui: "Interfaces with the UI"
      other-service: "Asks the other service for stuff"
    documentation: "The user of the application"

components:
  ui:
    description: "The user of the application"
    repository: "https://github.com/ArchDoc/archdoc-ui"
    tags:
      - "my"
      - "ui"
    dependencies:
      api: "Interfaces with the UI"
    documentation: "BLAH BLAH BLAH"
  other-service:
    description: "Another service in the model"
    repository: "https://github.com/ArchDoc/archdoc-ui"
    tags:
      - "my"
      - "other"
    documentation: "Documentation for the other service."
  api:
    description: "The API gateway of the application. This components provides a REST API to consumers."
    repository: "https://github.com/ArchDoc/archdoc-ui"
    tags:
      - "my"
      - "api"
    dependencies:
      auth-service: "Generates admin JWTs"
      recipe-service: "Manages users recipes"
      product-service: "Searches grocery store product catalogs"
    documentation: "The API gateway of the application. This components provides a REST API to consumers."
  auth-service:
    description: "A microservice with the purpose of authenticating and authorizing users. This service signs and returns properly signed JWTs to be reused by clients to access other resources"
    tags:
      - "my"
      - "auth"
    documentation: "Lorem ipsum dolor sit amet, consectetur adipiscing mod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, ullamco laboris nisi ut aliquip ex ea commodo consequat. Lorem ipsum dolor sit amet, consectetur adipiscing mod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, ullamco laboris nisi ut aliquip ex ea commodo consequat. consectetur adipiscing mod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, ullamco laboris nisi ut aliquip ex ea commodo consequat. Lorem ipsum dolor sit amet, consectetur adipiscing mod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, ullamco laboris nisi ut aliquip ex ea commodo consequat."
  recipe-service:
    description: "Service that is used to perform queries and operations on recipes."
    repository: "https://github.com/ArchDoc/archdoc-ui"
    tags:
      - "my"
      - "recipe"
    documentation: "Lorem ipsum dolor sit amet, consectetur adipiscing mod tempor incididunt ut labore et dolore magna aliqua."
  product-service:
  widget-service:
    description:  "A service that is used to query and search for widgets."
    repository: "https://github.com/ArchDoc/archdoc-ui"
    tags:
      - "my"
      - "widget"
    documentation: "Lorem ipsum dolor sit amet, consectetur adipiscing mod tempor incididunt ut labore et dolore magna aliqua."
`;