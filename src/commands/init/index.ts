import { Args, Command, Flags } from '@oclif/core'
import * as fs from 'fs'
import * as TOML from '@iarna/toml'

export default class Init extends Command {
    //static flags = {
    //config: Flags.string({char: 'c', description: 'toml config file', required: true}),
    //}
    async run(): Promise<void> {
        // create default toml file if not exists.
        //const {flags} = await this.parse(Init)
        const configFile = './codegpt.toml'
        const defaultConfigJson = {
            dependencies: {
                express: '4.18.1'
            },
            basic: {
                language: 'nodejs',
                arch: 'clean architecture',
                debug_retry: 3
            },
            openai: {
                api_key: 'xxx',
                temperature: 0.5,
                model: 'gpt-3.5-turbo'
            }
        }
        const defaultContent = TOML.stringify(defaultConfigJson)
        this.log('toml:' + defaultContent)
        fs.access(configFile, fs.constants.F_OK, error => {
            if (error) {
                this.log('init file: codegpt.toml')
                fs.writeFile(configFile, defaultContent, err => {
                    if (err) throw err;
                    this.log('codegpt.toml is created successfully')
                })
            } else {
                this.error('codegpt.toml already exists!')
            }
        })

    }
}
