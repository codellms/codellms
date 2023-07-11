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
        const configFile = './codellms.toml'
        const defaultConfigJson = {
            dependencies: {
                express: '4.18.1'
            },
            basic: {
                language: 'nodejs',
                arch: 'clean architecture',
                debug_retry: 3,
                type: 'api',
                db: 'sqlite'
            },
            openai: {
                api_key: '<your_openai_api_key>',
                temperature: 0.5,
                model: 'gpt-3.5-turbo'
            },
            api: {
                style: "restful"
            },
            db: {
                need_migration_file: false,
                sqlite: {
                    url: './db.sqlite',
                }
            }
        }
        const defaultContent = TOML.stringify(defaultConfigJson)
        fs.access(configFile, fs.constants.F_OK, error => {
            if (error) {
                this.log('init file: codellms.toml')
                fs.writeFile(configFile, defaultContent, err => {
                    if (err) throw err;
                    this.log('codellms.toml is created successfully')
                })
            } else {
                this.error('codellms.toml already exists!')
            }
        })

        if (!fs.existsSync('./features')) {
            fs.mkdirSync('./features', { recursive: true })
        }
    }
}
