# codellms

[![npm version](https://badge.fury.io/js/codellms.svg)](https://badge.fury.io/js/codellms)
Use gpt to generate a complete api project, supporting multiple programme languages.
Currently, only API type backend projects have been tested using Express in the example/todolist directory. It is not recommended for frontend projects. When GPT-4 opens up multimodal support, I believe that complete frontend and backend projects can be generated, and the frontend project can be generated based on the automatically generated API.

## features

* [x] Automatically initialize the project
* [x] Generate corresponding api according to requirements
* [x] Automatically install dependencies
* [x] automatic debug (The effect is not very good.)
* [x] Support modification and addition of requirements without re-running the entire project
* [ ] If the project is a RESTful API project, generate Swagger.
* [x] Create different dialogue contexts based on the feature files.
* [ ] Support using Claude API for code generation.
* [ ] Use database structure to assist GPT in understanding entity classes.
* [x] The new project supports generating DB migrate to create database structure.
* [ ] Avoid importing different packages that provide the same functionality.
## Installation

```
npm install -g codellms
```

or

``` shell
yarn global add codellms
```

## Usage

1. create config file(codellms.toml)

``` shell
codellms init
```

2. edit codellms.toml(Don't forget to use your own OpenAI API key) and write your feature in features folder.
The feature file follows the syntax of Gherkin (BDD) and uses the ".feature" suffix, for example, "todolist.feature".
The Gherkin syntax can be referred to here: [Gherkin Reference](https://cucumber.io/docs/gherkin/reference/).

Example of codellms.toml:

``` toml
[dependencies]
express='4.18.2' # For the main framework version, such as Express or Spring Boot, do not use too new of a framework. ChatGPT does not have knowledge of the latest frameworks.

[basic]
language = "node" # Java\Go\PHP...
arch = "mvc" # or clean architecture ...
type="api"
db="xxx"
folders=["src/models", "src/controller", "src/services", "src/utils"]
[api]
style="restful"
[openai]
api_key="<your_openai_aip_key>" # Required  Or you can use the environment variable:openai_api_key
model="gpt-3.5-turbo"
temperature=0.5
api_base="" # The default is https://api.openai.com/v1
[db]
need_migration_file=true
[db.xxx]
uri='./db.sqlite'
```

3. Generate your project code.

``` shell
codellms build
```

It will automatically create folders and code files. Due to the uncertainty of GPT's responses, you may need to try a few times.
