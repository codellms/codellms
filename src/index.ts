const path = require('path');
const yargs = require('yargs');
const fs = require('fs');
const toml = require('toml');

const argv = yargs
  .option('config', {
    alias: 'c',
    describe: 'Path to configuration file',
    default: 'codegpt.toml'
  })
  .argv;
const configPath = argv.config;
const configFile = fs.readFileSync(configPath, 'utf-8');
const config = toml.parse(configFile);
console.log('run run run!!!')
export {run} from '@oclif/core'
