# codellms
Use gpt to generate a complete api project, supporting multiple programme languages.

## features
- [x] Automatically initialize the project
- [x] Generate corresponding api according to requirements
- [x] Automatically install dependencies
- [x] automatic debug (The effect is not very good.)
- [ ] ~~Optimize token~~
- [x] Support modification and addition of requirements without re-running the entire project
- [ ] Create different dialogue contexts based on the feature files.
- [ ] Support using Claude API for code generation.
- [ ] Use database structure to assist GPT in understanding entity classes.
- [ ] The new project supports generating DB migrate to create database structure.

## Installation
```
npm install -g codellms

```

or

``` shell
yarn global add codellms
```

## Usage
1. create config file
``` shell
codellms init
```

2. edit codellms.toml and write your feature in features folder. 
The feature  file follows the syntax of Gherkin (BDD) and uses the ".feature" suffix, for example, "todolist.feature".
The Gherkin syntax can be referred to here: [Gherkin Reference](https://cucumber.io/docs/gherkin/reference/).

3. Generate your project code. 

``` shell
codellms build
```
It will automatically create folders and code files. Due to the uncertainty of GPT's responses, you may need to try a few times.  


