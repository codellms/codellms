
import { Args, Command, Flags } from '@oclif/core'
import { exit, test, touch, exec, ShellString, ExecOptions, echo } from 'shelljs'

import * as TOML from '@iarna/toml'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { AstBuilder, GherkinClassicTokenMatcher, Parser, compile } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'
import { Configuration, OpenAIApi } from 'openai'
import { stderr } from 'process'
//import { createHash } from "cryptography"
import { createHash } from 'node:crypto'

//let chats = []
export default class Build extends Command {
    static flags = {
        config: Flags.string({ char: 'c', description: 'toml config file', required: false, default: './codellms.toml' }),
        features: Flags.string({ char: 'f', description: 'features dir', required: false, default: './features/' }),
    }
    chats: Array<any> = []
    openai!: OpenAIApi;
    async run(): Promise<void> {
        const { flags } = await this.parse(Build)
        const configFile = fs.readFileSync(flags.config, 'utf-8')
        const config = JSON.parse(JSON.stringify(TOML.parse(configFile)))
        this.log('go go go')
        const apiKey = config['openai']['api_key'] || process.env['openai_api_key']
        if (!apiKey) {
            this.error('must provide openai api key')
            return;
        }
        const configuration = new Configuration({
            apiKey
        });
        this.openai = new OpenAIApi(configuration);
        this.chats.push(this.buildFirstChat(config))
        //if the lock file does not exist
        if (!test('-f', './codellms-lock.json')) {
            await this.initProject()
        }
        await this.parseFeatures(flags.features)//create code with features
        await this.createMainfile()
        await this.installDependencies()
        await this.tryBuildOrStart()// debug with unitest,build...
    }

    buildFirstChat(config: any) {
        let osPlatform: string = os.platform()
        let osVersion: string = os.release()
        if (osPlatform == 'darwin') {
            osVersion = exec('sw_vers -productVersion').stdout
            osPlatform = 'macOS'
        }
        return {
            "role": "system", "content": `You are ChatGPT, a large language model trained by OpenAI.I hope you can act as a coding expert and use ${config['basic']['language']} to develop using the following framework or library: ${JSON.stringify(config['dependencies'])}, and use ${config['basic']['arch']} pattern for project architecture.
You need to return in the format I requested, without any other content. No explanation or other non-code replies are required.
For example, when I ask you to return an array, In the following format:
[[code]]
insert array here
[[/code]]
,you only need to reply with an array, such as returning this content directly:
[[code]]
["a", "b", "c"]
[[/code]]
.
The format below is incorrect:
\`\`\`javascript
["a", "b", "c"]
\`\`\`
.Current OS is ${osPlatform}, os version is ${osVersion}`
        }
    }
    getBlockContent(strInput: string, blockName: string): string {
        //const regxStr = `(?<=\[\[${blockName}\]\]\n)([\s\S]*?)(?=\n\[\[\/${blockName}\]\]$)`;
        const regxStr = `(?<=\\[\\[${blockName}\\]\\]\\n)([\\s\\S]*?)(?=\\n\\[\\[\\/${blockName}\\]\\]$)`;

        const regx = new RegExp(regxStr, 'sm')
        //if(regx.test(strInput)){
        let content = regx.exec(strInput)?.[1] || undefined
        return content || strInput
        //}
        //return strInput
    }
    async askgpt(question: Array<any>): Promise<string | undefined> {
        const response = await this.openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: question,
            temperature: 0.4
        })
        this.log('chatgpt response:')
        const result = response.data.choices?.[0]
        const answerResult: string | undefined = result?.message?.content
        if (result?.finish_reason === 'stop' || result?.finish_reason === 'content_filter') {
            this.chats.push({ "role": result?.message?.role, "content": answerResult })
        } else {
            this.log('gpt need continue')
            //this.chats.push({ "role": "user", "content": "continue"})
            //this.askgpt(this.chats)// continue
        }
        this.log(answerResult)
        return answerResult
    }

    // if the codellms.lock does not exist.
    async initProject(): Promise<void> {
        // init project
        const chat = { "role": "user", "content": `Please tell me what command to use to initialize this project in the current directory. Reply with the executable command that can automatically confirm execution without any user interaction. Please do not include any further explanation in your response. For example, a valid response could be: "npx express-generator . --no-view && npm install -y".` }
        this.chats.push(chat)
        let initCommandAnswer = await this.askgpt(this.chats)
        initCommandAnswer = this.cleanCodeBlock(initCommandAnswer!) as string
        this.execCommand(initCommandAnswer)
        touch('codellms.lock')
        // init folder
        this.chats.push({ "role": "user", "content": `Please tell me which folders need to be created, and return them in an array. Multi-level directories can be represented directly as "a/b/c".` })
        const answer = await this.askgpt(this.chats)
        this.log('init folders:', answer)
        Array.from(JSON.parse(answer!)).forEach(f => {
            const fd = f as fs.PathLike
            this.createFolder(fd)
        })// init folder

    }

    createFolder(folder: fs.PathLike): void {
        this.log('folder name:')
        this.log(folder.toString())
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true })
        }
    }

    createFile(file: string, content: string | NodeJS.ArrayBufferView) {
        let fileStr = file?.replaceAll("\"", "").replaceAll("\'", "")
        if (fileStr.indexOf('/') > -1) {
            let folderArr = fileStr.split('/')
            folderArr.pop()// remove file name and ext
            this.createFolder(folderArr.join('/') as fs.PathLike)
        }
        this.log('create file:', fileStr)
        fs.writeFileSync(fileStr as fs.PathOrFileDescriptor, content)
    }
    execCommand(command: string | undefined, cb?: { onSuccess?: Function, onError?: Function }): void {
        if (command && command.trim()) {
            const { onSuccess, onError } = cb || {}
            //let maybeDoExit = setTimeout(() => exit(1), 10000)// If the following commands are not automatically terminated
            const execResult: ShellString = exec(command.trim())
            //clearTimeout(maybeDoExit)
            if (execResult.code !== 0) {
                echo(`Error: exec command fail,command is: ${command}`)
                if (onError) {
                    onError(execResult.stderr)
                }
            } else {
                this.log('Success:command is:', command)
                this.log(`command: '${command}'executed successfully`)
                if (onSuccess) {
                    onSuccess(execResult.stdout)
                }
            }
        }
    }
    // add and install dependencies to project.
    async installDependencies(): Promise<void> {
        const chat = { "role": "user", "content": "Based on the code you provided, please tell me the command to add dependencies and which dependencies are needed. Please provide the command directly without explanation. Here is an example of what should be returned: npm install express uuid --save." }
        this.chats.push(chat)
        const answer = await this.askgpt(this.chats)
        this.execCommand(answer)
        // exec()
        // which dependencies
        // what is install command?
        // evel install ,example:npm install
    }
    // remove ````
    cleanCodeBlock(codeContent: string | NodeJS.ArrayBufferView): string | NodeJS.ArrayBufferView {
        let hasBlock = (codeContent as string)?.trim().startsWith("```")
        let codeBody = codeContent
        if (hasBlock) {
            let lines = (codeContent as string).split('\n')
            lines.shift()
            lines.pop()
            codeBody = lines.join('\n')
        }
        return codeBody
    }
    getLockFile(): { [key: string]: any } {
        const codellmsLockFile = fs.readFileSync('codellms-lock.json')
        let lockFeatureJson: { [key: string]: any } = {};
        if (!!codellmsLockFile.toString()?.trim()) {
            lockFeatureJson = JSON.parse(codellmsLockFile.toString())
        }
        return lockFeatureJson
    }
    async createMainfile() {
        let lockFeatureJson: { [key: string]: any } = this.getLockFile();

        let chat = {
            "role": "user", "content": `Please tell me the code content of the project's entry file and its file path. Without any explanatory or descriptive text. Here is an example of what should be returned:
[[file]]
put the file path here
[[/file]]
[[code]]
insert code here
[[/code]]
`}
        const mainFilePath: string | undefined = lockFeatureJson['main']?.['path']
        if (mainFilePath) {
            let mainFileContent = fs.readFileSync(mainFilePath)?.toString()
            chat = {
                "role": "user",
                "content": `
The code for my entry file is as follows:
[[code]]
${mainFileContent}
[[/code]]
, please determine based on our previous conversation whether this file needs to be modified.
If modification is required, please return in the following format:
[[code]]
insert code here(If no modification is necessary or if there is insufficient information to make a determination, simply return null here.)
[[code]]
. If no modification is necessary or if there is insufficient information to make a determination, simply return null in this [[code]] block, For example:
[[code]]
null
[[/code]]
`
            }
        }
        this.chats.push(chat)
        const answer = await this.askgpt(this.chats) as string
        const filePath = mainFilePath || this.getBlockContent(answer, 'file')
        const codeBody = this.getBlockContent(answer, 'code')
        if (filePath && !!codeBody && codeBody !== "null") {
            this.createFile(filePath!, codeBody!)

            const mainFileHash = createHash('sha512').update(codeBody, 'utf-8').digest('hex')
            lockFeatureJson['mainfile'] = {
                integrity: mainFileHash,
                path: filePath
            }
            this.createFile('codellms-lock.json', JSON.stringify(lockFeatureJson))
        }
    }
    // parse bdd feature file
    async parseFeatures(featuredir: fs.PathLike) {
        // 1.load file
        // 2. parse
        const uuid = IdGenerator.uuid()
        const builder = new AstBuilder(uuid)
        const matcher = new GherkinClassicTokenMatcher()
        const parser = new Parser(builder, matcher)

        const filenames = fs.readdirSync(featuredir)
        // start read codellms lock file.
        let lockFeatureJson: { [key: string]: any } = this.getLockFile();

        // read codellms lock file end.
        for (let j = 0; j < filenames.length; j++) {
            const file = filenames[j]
            if (path.extname(file) === '.feature') {
                const spec = fs.readFileSync(path.join(featuredir.toString(), file), 'utf-8')
                const specHash = createHash('sha512').update(spec, 'utf-8').digest('hex')
                // Determine whether the file has been modified
                const featureNodeInLock: { [key: string]: any } | undefined = lockFeatureJson['features']?.[file]
                if (featureNodeInLock !== undefined) {
                    if (featureNodeInLock['integrity'] === specHash) {
                        continue;
                    }
                }
                // todo: read the original code
                lockFeatureJson['features'] = {
                    [file]: {
                        integrity: specHash,
                        childrens: []// Code files generated by gpt
                    }
                }// init feature file node

                const chat = {
                    "role": "user", "content": `There is a requirement described in a BDD-like format, which describes the features that need to be created in the scenario.
Now, please tell me the list of files with file paths that need to be created based on the requirement, and return them in an array.
Sort the array in reverse order according to the call tree relationship and array items of character type use double quotes instead of single quotes, Do not return note or punctuation other than this array object, For correct example:
[[code]]
["./src/model/xxx.js","./src/controller/xxx.js"]
[[/code]]
.
The requirements content are as follows: \`\`\`${spec.toString()} \`\`\`.
Let's think step by step. ` }
                this.chats.push(chat)
                let answer = await this.askgpt(this.chats) as string
                answer = this.getBlockContent(answer, 'code') as string
                const codeFiels = Array.from(JSON.parse(answer))
                for (let i = 0; i < codeFiels.length; i++) {
                    const f = codeFiels[i] as string
                    this.log('code file:', f)
                    lockFeatureJson['features'][file]['childrens'].push(f)
                    this.chats.push({
                        "role": "user", "content": `
Please provide the content of file ${f}, and think step by step to make the code clean, maintainable, and accurate.
The replied code should be complete, with comments for each method. Other than that, no additional explanation is necessary.
Please return the corresponding content in the following format.
[[code]]
insert code here
[[/code]]
.Let's think step by step
`})
                    const codeContent = await this.askgpt(this.chats) as string
                    //let codeBody = this.cleanCodeBlock(codeContent)
                    let codeBody = this.getBlockContent(codeContent, 'code')
                    //const filePath = f as fs.PathOrFileDescriptor
                    this.createFile(f, codeBody!)
                }
            }
        }
        this.createFile('codellms-lock.json', JSON.stringify(lockFeatureJson))
        // build project , tell project index to gpt if has error
    }
    async tryBuildOrStart(): Promise<void> {
        // todo: If it's a scripting language use unit tests instead of running the project.
        const ask = { "role": "user", "content": "Please tell me the startup (scripting language) or build (compiled language) command for this project. so that I can run it in the current directory to get a preliminary idea of whether there are any errors .This command hopes that the console will not output warning, and the information you reply will only be executable commands, without any other information. For example, return it like this: RUSTFLAGS=-Awarnings cargo build." }
        this.chats.push(ask)
        let answer = await this.askgpt(this.chats)
        this.log('build command:', answer)
        let retryConfig = 1// from config file
        let retry = 0
        const retryAsk = async (err: string) => {
            if (retry > retryConfig)
                return
            retry += 1;
            // ask gpt
            this.chats.push({
                "role": "user", "content": `During program execution, the following error occurred: '${err}' .Please think step by step about how to correct it and return the entire modified file code to me. If there are multiple files to modify, only return the first file.No need to explain the modification, just provide me with the correct code.For example:
[[file]]
insert file path here
[[/file]]
[[code]]
insert code here
[[/code]]
`})
            let tryCorretCode = await this.askgpt(this.chats) as string
            let filePath = this.getBlockContent(tryCorretCode!, 'file')
            let maybeCorretCode = this.getBlockContent(tryCorretCode!, 'code') as string
            //tryCorretCode = this.cleanCodeBlock(tryCorretCode) as string
            if (filePath) {
                this.createFile(filePath!, maybeCorretCode!)
            }
            this.execCommand(answer, { onSuccess: () => exit(1), onError: retryAsk })

        }
        this.execCommand(answer, {
            onSuccess: () => {
                this.log('onsuccess callback')
                exit(1)
            },
            onError: retryAsk
        })
    }
}
