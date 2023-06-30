# codegpt
Use gpt to generate a complete api project, supporting multiple programme languages.

# features
- [x] Automatically initialize the project
- [x] Generate corresponding api according to requirements
- [x] Automatically install dependencies
- [x] automatic debug (The effect is not very good.)
- [ ] ~~Optimize token~~
- [x] Support modification and addition of requirements without re-running the entire project
- [ ] Support using Claude API for code generation.
- [ ] Use database structure to assist GPT in understanding entity classes.
- [ ] The new project supports generating DB migrate to create database structure.

# how to use it?
## install
```
npm install codegpt --global
codegpt init
// edit codegpt.toml and write your feature in features folder
codegpt build

```
## 