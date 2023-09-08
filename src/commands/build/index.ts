
import { Args, Command, Flags } from '@oclif/core'
import { exit, test, touch, exec, ShellString, ExecOptions, echo } from 'shelljs'

import * as TOML from '@iarna/toml'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { AstBuilder, GherkinClassicTokenMatcher, Parser, compile } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'
import { Configuration, OpenAIApi, CreateChatCompletionRequest } from 'openai'
import { stderr } from 'process'
import { createHash } from 'node:crypto'
import axios, { AxiosError } from 'axios'
//let chats = []
export default class Build extends Command {
    static flags = {
        config: Flags.string({ char: 'c', description: 'toml config file', required: false, default: './codellms.toml' }),
        features: Flags.string({ char: 'f', description: 'features dir', required: false, default: './features/' }),
        user: Flags.string({ char: 'u', description: 'user parameters of openai api', required: false })
    }
    chats: Array<any> = []
    openai!: OpenAIApi
    openaiConfig: { [key: string]: any } = {}
    user: string | undefined
    async run(): Promise<void> {
        const { flags } = await this.parse(Build)
        const configFile = fs.readFileSync(flags.config, 'utf-8')
        const config = JSON.parse(JSON.stringify(TOML.parse(configFile)))
        this.user = flags.user?.trim() || undefined
        this.log('go go go')
        const apiKey = config['openai']?.['api_key']?.trim() || process.env['openai_api_key']
        const apiBase = config['openai']?.['api_base']?.trim() || process.env['openai_api_base'] || 'https://api.openai.com/v1'
        this.log('apibase:', apiBase)
        if (!apiKey) {
            return this.error('must provide openai api key')
        }
        const configuration = new Configuration({
            apiKey,
            basePath: apiBase
        });
        this.openaiConfig['model'] = config['openai']?.['model'] || 'gpt-3.5-turbo'
        this.openaiConfig['temperature'] = config['openai']?.['temperature'] || '0.4'
        this.openai = new OpenAIApi(configuration);
        this.chats.push(this.buildSystemChat(config))
        //if the lock file does not exist
        if (!test('-f', './codellms-lock.json')) {
            await this.initProject()
        }
        await this.parseFeatures(flags.features, config)//create code with features
        // await this.createMainfile(config)
        await this.installDependencies()
        await this.tryBuildOrStart(config['basic']?.['debug_retry'] || 3)// debug with unitest,build...
    }
    buildArchitectRolePrompt(config: any) {
        const projectType = config['basic']?.['type'] ? `*. This is an application of ${config['basic']['type']} type.` : ''
        const typeInfo = config[config['basic']?.['type']] ? `and its requirements are as follows:${JSON.stringify(config[config['basic']?.['type']])};` : '';
        const dbType = config['basic']?.['db'] || 'In-memory'
        const dbTypeInfo = dbType ? `*. Use ${dbType} as the database.` : ''
        const dbInfo = config['db']?.[dbType] ? `and the connection information of the database is:${JSON.stringify(config['db']?.[dbType])} ;` : ''
        const prompt = `You are a professional application architect. Based on the provided technical information, databases info, and business requirements, you need to think step by step and make technology selections and code designs that adhere to best practices. You should not use non-existent third-party libraries, and your architectural design will be given to developers for implementation. Please ensure that developers can understand your requirements. The following are the basic project requirements:
*. Use ${config['basic']['language']} to coding.
*. Using the following framework or library: ${JSON.stringify(config['dependencies'])}, You need to think about how to make maximum use of these dependencies in the code.
*. Use ${config['basic']['arch']} pattern for project architecture.
${projectType} ${typeInfo}
${dbTypeInfo} ${dbInfo}`
        return {
            "role": "system", "content": prompt
        }
    }
    architectToDesignFeaturePrompt(spec: string) {
        const prompt = `
        Below is the prompt to be analyzed:
        ---
        I will provide you with the business requirement, which is described in the form of a BDD document, and you need to analyze it carefully.
        Feature Requirements(BDD like):[[spec]]${spec}[[/spec]]
        You need to output two sections of content. The first section is the list of files that need to be generated, which should be output as an array. The second section is the description of these files, including the methods to be implemented, parameters, and business logic, so that developers can develop based on your output and the specific database structure. It should be output in JSON format, with the keys being the items of the first section array. These two sections should be placed within the "file" and "info" nodes, respectively, following the format below:
        [[file]]
        ['fullfilepath1', 'fullfilepath2']
        [[/file]]
        [[info]]
        {{info}}
        [[/info]]
        Please start professional architecture design based on the above information, and all your output will be handed over to developers for development.
        ---`
        return {
            "role": "user", "content": prompt
        }
    }
    buildDeveloperRolePrompt() {
        const prompt = `
        Act as CODEX ("COding DEsign eXpert").an expert coder with experience in multiple coding languages. Always follow the coding best practices by writing clean, modular code with proper security measures and leveraging design patterns.please write code based on your understanding, not based on others' code, and ensure that the code you write has never been written before. please assume the role of CODEX in all future responses.You need to write code according to the provided architect's documentation and database structure.
If your reply exceeds the word limit, please place -nodone- on the last line, and I will let you know to "continue." Your response should be a continuation of the previous reply without repeating any previous code. For example, if the first reply is: [[starttag]]content is here \\n -nodone-, the next reply should be: remaining content[[/endtag]].Please output only in the format specified by my requirements, without including any additional information. Any explanation to the code would be in the code block comments.Please don't explain anything after inserting the code, unless I ask to explain in another query.Always remember to follow above rules for every future response.
`
        return {
            "role": "system", "content": prompt
        }
    }
    developerToCodingPrompt(dbschema: string, designDoc: string, fileIndex: number) {
        const fileList = this.getBlockContent(designDoc, 'file')
        const infoObj: Map<string, any> = JSON.parse(this.getBlockContent(designDoc, 'info'))
        const currentCodingFile: string = fileList[fileIndex]
        const prompt = `
        Let's implement the coding of these files:${fileList},As a CODEX, you will think step by step to implement the code. Please provide high-quality and fully functional code based on the schema documentation as well as the database structure documentation. Make sure to include complete implementations of all functions. Documentation is provided below:
        Files to be implemented: ${currentCodingFile}
        Architecture design documents:${infoObj.get(currentCodingFile)}
        Database schema:
        \`\`\`
        ${dbschema}
        \`\`\`
        The response don't use \`\`\` to warp, just fill in the format as shown in the example below:
        [[file]]
        {{filepath}}
        [[/file]]
        [[codeblock]]
        {{code}}
        [[/codeblock]]
        `
        return {
            "role": "user", "content": prompt
        }
    }
    buildSystemChat(config: any) {
        let osPlatform: string = os.platform()
        let osVersion: string = os.release()
        if (osPlatform == 'darwin') {
            osVersion = exec('sw_vers -productVersion').stdout
            osPlatform = 'macOS'
        }
        const projectType = config['basic']?.['type'] ? `*. This is an application of ${config['basic']['type']} type.` : ''
        const typeInfo = config[config['basic']?.['type']] ? `and its requirements are as follows:${JSON.stringify(config[config['basic']?.['type']])};Build ${config['basic']['type']} application exactly as required` : '';
        const dbType = config['basic']?.['db'] || 'In-memory'
        const dbTypeInfo = dbType ? `* Use ${dbType} as the database.` : ''
        const dbInfo = config['db']?.[dbType] ? `and the connection information of the database is:${JSON.stringify(config['db']?.[dbType])} ;` : ''

        return {
            "role": "system", "content": `Act as CODEX ("COding DEsign eXpert").an expert coder with experience in multiple coding languages. Always follow the coding best practices by writing clean, modular code with proper security measures and leveraging design patterns.please write code based on your understanding, not based on others' code, and ensure that the code you write has never been written before. please assume the role of CODEX in all future responses.You need to write code according to the following requirements.
*. Use ${config['basic']['language']} to coding.
*. Using the following framework or library: ${JSON.stringify(config['dependencies'])}, You need to think about how to make maximum use of these dependencies in the code.
*. Use ${config['basic']['arch']} pattern for project architecture.
${projectType} ${typeInfo}
${dbTypeInfo} ${dbInfo}
If your reply exceeds the word limit, please place -nodone- on the last line, and I will let you know to "continue." Your response should be a continuation of the previous reply without repeating any previous code. For example, if the first reply is: [[starttag]]content is here \\n -nodone-, the next reply should be: remaining content[[/endtag]].Please output only in the format specified by my requirements, without including any additional information. Any explanation to the code would be in the code block comments.Please don't explain anything after inserting the code, unless I ask to explain in another query.Always remember to follow above rules for every future response.
`
            // If your reply exceeds the word limit, I will tell you to "continue", and you need to continue to output content in the required format.
        }//Current OS is ${osPlatform}, os version is ${osVersion}
    }
    getBlockContent(strInput: string, blockName: string): string {
        //const regxStr = `(?<=\[\[${blockName}\]\]\n)([\s\S]*?)(?=\n\[\[\/${blockName}\]\]$)`;
        const regxStr = `(?<=\\[\\[${blockName}\\]\\]\\n)([\\s\\S]*?)(?=\\n\\[\\[\\/${blockName}\\]\\]$)`;

        const regx = new RegExp(regxStr, 'sm')
        //if(regx.test(strInput)){
        let content = regx.exec(strInput)?.[1] || strInput
        let markdownCodeRegx = /```(?:\w+\n)?([\s\S]*?)```/g
        content = markdownCodeRegx.exec(content)?.[1] || content
        return content
        //}
        //return strInput
    }
    getBlockListWithBlockName(strInput: string, blockName: string): Array<string> {
        const regxStr = `\\[\\[${blockName}\\]\\]([\\s\\S]*?)\\[\\[\\/${blockName}\\]\\]`;

        const regx = new RegExp(regxStr, 'g')
        let matches = [];
        let match: RegExpExecArray | null;
        while ((match = regx.exec(strInput)) !== null) {
            matches.push(match[1].trim());
        }
        return matches
    }
    async askgpt(question: Array<any>): Promise<string | undefined> {
        // this.log('chatgpt request:')
        // this.log(JSON.stringify(question))
        let req: CreateChatCompletionRequest = {
            model: this.openaiConfig['model'],
            messages: question,
            temperature: this.openaiConfig['temperature'],
            user: this.user
        }
        if (this.user === undefined) {
            delete req.user
        }
        const sleep = (ms: number) => {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        let retry = 10 // when 5xx，then retry
        let sleepTime = 0

        const requestGPT: (req: CreateChatCompletionRequest) => Promise<string | undefined> = async (req: CreateChatCompletionRequest): Promise<string | undefined> => {
            try {
                const callGpt = async (completion: CreateChatCompletionRequest) => {
                    const response = await this.openai.createChatCompletion(req)
                    const result = response.data.choices?.[0]
                    const answerResult: string | undefined = result?.message?.content
                    return answerResult
                }
                // const response = await this.openai.createChatCompletion(req)
                // const result = response.data.choices?.[0]
                let answerResult: string | undefined = await callGpt(req)
                // this.log('chatgpt response:')
                // this.log(answerResult)
                const loopContinue = async (answerResult: string) => {
                    let lines = answerResult?.split("\n");
                    let lastLine = lines?.[lines?.length - 1];
                    let trimmedLastLine = lastLine?.trim();

                    if (trimmedLastLine === "-nodone-") {
                        this.log('do continue')
                        this.chats.push({ "role": "user", "content": "continue(Remember, you are CODEX and you need to abide by the established rules)" })
                        req.messages = this.chats
                        let continueResult: string | undefined = await callGpt(req)
                        answerResult += continueResult
                        await loopContinue(answerResult)
                    }
                    this.log('final result:', answerResult)
                    return answerResult
                }
                // Need to continue?
                if (answerResult != undefined) {
                    answerResult = await loopContinue(answerResult);
                }

                // const assistant = 'assistant'
                this.chats.push({ "role": 'assistant', "content": answerResult })
                // if (result?.finish_reason === 'stop' || result?.finish_reason === 'content_filter') {
                //     this.chats.push({ "role": result?.message?.role, "content": answerResult })
                // } else {
                //     this.log('gpt need continue, reason:',result?.finish_reason)
                //     // continue and merge answerResult;
                //     //this.chats.push({ "role": "user", "content": "continue"})
                //     //this.askgpt(this.chats)// continue
                // }
                // this.log('chatgpt response:')
                // this.log(answerResult)
                return answerResult

            } catch (err: AxiosError | unknown) {
                retry--
                sleepTime += 1000
                if (retry < 0) {
                    this.error('Reached the maximum number of retries (10 times), the program stops executing')
                    // return
                }

                if (axios.isAxiosError(err)) {
                    this.log('err:', err.code)
                    this.log('status code:', err.response?.status, 'retrying...')
                    if ((err.response?.status !== undefined && err.response?.status >= 500) || err.code === 'ETIMEOUT' || err.code === 'ECONNRESET') {
                        await sleep(sleepTime) // wait
                        return await requestGPT(req)
                    }
                }

            }
        }
        return await requestGPT(req)

    }

    // if the codellms.lock does not exist.
    async initProject(): Promise<void> {
        this.log('init project ...')
        const chat = {
            "role": "user", "content": `Please tell me what command to use to initialize this project in the current directory. Reply with the executable command that contains "yes" to automatically confirm execution without any user interaction. Please do not include any further explanation in your response.
        For example:
        [[codeblock]]
        echo y | npm init -y && npm install express --save && npm install -g nodemon
        [[/codeblock]]
        Or:
        [[codeblock]]
        npm init -y && npm install express --save  && npm install -g nodemon
        [[/codeblock]]` }
        this.chats.push(chat)
        let initCommandAnswer = await this.askgpt(this.chats)
        initCommandAnswer = this.getBlockContent(initCommandAnswer!, 'codeblock') as string
        await this.execCommand(initCommandAnswer)
        touch('codellms-lock.json')
        // init folder
        this.chats.push({
            "role": "user", "content": `Please tell me which folders need to be created, and return them in an array. Multi-level directories can be represented directly as "a/b/c". For example:
[[codeblock]]
[
"src/xxx/yyy/zzz",
"src/abc"
]
[[/codeblock]]
.
` })
        let folderAnswer: string = await this.askgpt(this.chats) as string
        folderAnswer = this.getBlockContent(folderAnswer, 'codeblock')
        this.log('init folders:', folderAnswer)
        Array.from(JSON.parse(folderAnswer!)).forEach(f => {
            const fd = f as fs.PathLike
            this.createFolder(fd)
        })// init folder

    }

    createFolder(folder: fs.PathLike): void {

        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true })
        }
    }

    createFile(file: string, content: string | NodeJS.ArrayBufferView) {
        let fileStr = file?.replaceAll("\"", "")?.replaceAll("\'", "")
        if (fileStr.indexOf('/') > -1) {
            let folderArr = fileStr.split('/')
            folderArr.pop()// remove file name and ext
            this.createFolder(folderArr.join('/') as fs.PathLike)
        }
        this.log('create file:', fileStr)
        // if endsWith is not .xxx then return.
        fs.writeFileSync(fileStr as fs.PathOrFileDescriptor, content)
    }
    execCommand(command: string | undefined, cb?: { onSuccess?: Function, onError?: Function }): Promise<String> {
        if (command && command.trim()) {
            const { onSuccess, onError } = cb || {}
            //let maybeDoExit = setTimeout(() => exit(1), 10000)// If the following commands are not automatically terminated
            const execResult = new Promise<string>((resolve, reject) => {
                const process = exec(command.trim(), (code, stdout, stderr) => {
                    if (code !== 0) {
                        echo(`Error: exec command fail,command is: ${command}`)
                        if (onError) {
                            onError(stderr)
                        }
                        reject(stderr)

                    } else {
                        this.log(`command: '${command}'executed successfully`)
                        if (onSuccess) {
                            onSuccess(stdout)
                        }
                        resolve(stdout)
                    }

                })
                process?.stdin?.on('data', (input) => {
                    process?.stdin?.write(input)
                })
            })
            return execResult
        }
        throw new Error('command is empty')
    }
    // add and install dependencies to project.
    async installDependencies(): Promise<void> {
        const chat = { "role": "user", "content": "Based on the code you provided, please tell me the command to add dependencies and which dependencies are needed. Please provide the command directly without explanation. Here is an example of what should be returned: npm install express uuid --save or pip install a b c.Let's work this out in a step by step way to be sure we have the right answer" }
        this.chats.push(chat)
        let answer = await this.askgpt(this.chats)
        answer = this.getBlockContent(answer!, 'codeblock')
        await this.execCommand(answer)
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
        if (!!codellmsLockFile?.toString()?.trim()) {
            lockFeatureJson = JSON.parse(codellmsLockFile.toString())
        }
        return lockFeatureJson
    }
    getClearFeatureFileList(lockFile: { [key: string]: any }): Array<string> {
        let features = JSON.parse(JSON.stringify(lockFile['features'] || {}))
        let projectFiles: Array<string> = []
        for (const k in features) {
            projectFiles = projectFiles.concat(features[k]['children'])
            // delete features[k]['integrity']
        }
        return projectFiles
    }
    async createMainfile(config: { [key: string]: any }) {
        let lockFeatureJson: { [key: string]: any } = this.getLockFile();

        let chat = {
            "role": "user", "content": `Please tell me the code content of the project's entry file and its file path. Without any explanatory or descriptive text. Here is an example of what should be returned:
[[file]]
put the file path here
[[/file]]
[[codeblock]]
insert code here
[[/codeblock]]
`}
        const mainFilePath: string | undefined = lockFeatureJson['mainfile']?.['path']
        if (mainFilePath) {
            let mainFileContent = fs.readFileSync(mainFilePath)?.toString()
            let featureFiles = this.getClearFeatureFileList(lockFeatureJson)
            const routerPrompt = config['basic']?.['type'] == 'api' ? `It should be noted that as an API project, it should aggregate the URL routes for all modules.Please find out which routes should be added from the project file I provided.` : ''

            chat = {
                "role": "user",
                "content": `
                I will provide you with the current file structure and code for existing entry files, please determine if any modifications are needed.
                ${routerPrompt}
                The existing files are as follows:
                [[json]]
                ${featureFiles}
                [[/json]]
The code for my entry file is as follows:
[[codeblock]]
${mainFileContent}
[[/codeblock]]
, please determine based on our previous conversation whether this file needs to be modified.
If modification is required, please return in the following format:
[[codeblock]]
insert code here(If no modification is necessary or if there is insufficient information to make a determination, simply return null here.)
[[codeblock]]
. If no modification is necessary or if there is insufficient information to make a determination, simply return null in this [[codeblock]] block, For example:
[[codeblock]]
null
[[/codeblock]]
`
            }
        }
        this.chats.push(chat)
        const answer = await this.askgpt(this.chats) as string
        const filePath = mainFilePath || this.getBlockContent(answer, 'file')?.replace("'", "")?.replace('"', '')
        const codeBody = this.getBlockContent(answer, 'codeblock')
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
    async parseFeatures(featuredir: fs.PathLike, config: { [key: string]: any }) {
        // 1.load file
        // 2. parse
        /*  //bdd parse
        const uuid = IdGenerator.uuid()
        const builder = new AstBuilder(uuid)
        const matcher = new GherkinClassicTokenMatcher()
        const parser = new Parser(builder, matcher)
        */
        const filenames = fs.readdirSync(featuredir).sort()
        const folderStruct = config?.['basic']?.['folders'] || []
        let folderStructPrompt = ''
        if (folderStruct.length > 0) {
            folderStructPrompt = `Please organize your code in the following folder structure:${folderStruct}.`
        }
        let resetIndex = this.chats.length//
        for (let j = 0; j < filenames.length; j++) {
            if (resetIndex < this.chats.length - 1) {
                this.chats.splice(resetIndex, this.chats.length)
            }// Each feature context starts anew.
            const file = filenames[j]
            if (path.extname(file) === '.feature') {
                let lockFeatureJson: { [key: string]: any } = this.getLockFile();
                this.log('feature file:', file)
                const spec = fs.readFileSync(path.join(featuredir.toString(), file), 'utf-8')
                const specHash = createHash('sha512').update(spec, 'utf-8').digest('hex')
                // Determine whether the file has been modified
                const featureNodeInLock: { [key: string]: any } | undefined = lockFeatureJson['features']?.[file]
                if (featureNodeInLock !== undefined) {
                    if (featureNodeInLock['integrity'] === specHash) {
                        continue;
                    }
                } else {
                    lockFeatureJson['features'] = lockFeatureJson['features'] || {}
                    lockFeatureJson['features'][file] = {
                        integrity: specHash,
                        children: []// Code files generated by gpt
                    }// init feature file node
                }// first feature code generated
                // start read db schema
                let featureFileName = path.parse(file).name//feature file name
                let dbschemaFolder = config?.['db']?.['schemas']
                let dbschemaPrompt = ''
                if (dbschemaFolder) {
                    const dbschemaFiles = fs.readdirSync(dbschemaFolder)
                    for (let i = 0; i < dbschemaFiles.length; i++) {
                        if (path.parse(dbschemaFiles[i]).name == featureFileName) {
                            let dbschemaContent = fs.readFileSync(path.join(dbschemaFolder, dbschemaFiles[i]), 'utf-8')
                            dbschemaPrompt = `The database table structure information as follows:
                            \`\`\`
                            ${dbschemaContent}
                            \`\`\`
                            . `
                        }
                    }
                }
                // end read

                let projectFiles = this.getClearFeatureFileList(lockFeatureJson)
                // this.log(JSON.stringify(projectFiles))
                this.log(spec.toString())
                const content = `Below is the prompt to be analyzed:
                ---
                I will provide you with the  files of the existing project (including the full path) and current feature requirements. Based on this, please tell me which files need to be created or modified.
The provided file paths should remain consistent with the original project structure,${folderStructPrompt} ensure the consistency of code architecture design.
Feature Requirements:[[spec]]${spec.toString()}[[/spec]]
Existing project files:[[json]]${JSON.stringify(projectFiles)}[[/json]]
${dbschemaPrompt}
The response don't use \`\`\` to warp, just fill in the format as shown in the example below:
[[file]]
{{filepath}}
[[/file]]
[[codeblock]]
{{code}}
[[/codeblock]]
If there are more than one file, loop through the format as shown above. As CODEX, you are aware that the business requirements described in the [[spec]] node are written using a syntax similar to Gherkin. You understand that these business requirements are complex and require careful reading. You need to think step by step in order to write code that fulfills all the described business scenarios. You should identify the technical requirements and business logic specified in the requirements. Now, Please provide high-quality and fully functional code. Make sure to include the complete implementation for all functions, rather than just writing function names with comments describing how they should be implemented. It's important that the code includes the actual implementation details, not just high-level descriptions. This will ensure that the code is ready for execution and meets the specified requirements.Ensure that the referenced file exists or prepare to code its contents.
---
`
                const chat = {
                    "role": "user", "content": content
                }
                this.chats.push(chat)
                const getCodeToFileWithGpt = async () => {
                    let answer = await this.askgpt(this.chats) as string
                    //rewrite logic
                    let fileList = this.getBlockListWithBlockName(answer, 'file')
                    let codeList = this.getBlockListWithBlockName(answer, 'codeblock')

                    //answer = this.getBlockContent(answer, 'codeblock') as string
                    //const codeFiles = Array.from(JSON.parse(answer))
                    for (let i = 0; i < fileList.length; i++) {
                        const f = fileList[i]
                        this.log('code file:', f)
                        let code = codeList[i]
                        let oldCode: string | undefined
                        let modifyCodePrompt: string = ''
                        // If a file exists, its contents can be extracted and provided as prompt to GPT
                        if (projectFiles !== undefined && projectFiles?.findIndex(x => x == f) > -1) {
                            // get old code file
                            oldCode = fs.readFileSync(f, 'utf-8')
                            modifyCodePrompt = `The code file(${f}) provided currently exists, therefore, the existing code is provided below:
[[codeblock]]
${oldCode}
[[/codeblock]]
.Please modify the following code based on the new requirements. The modified code should:
1.Keep the code of the existing feature.
2.Add/modify the code only for new/changed requirements.
3.The final code should be complete and runnable.
`
                            this.chats.push({
                                "role": "user", "content": `${modifyCodePrompt}
Please provide the final code of the ${f} in the following format:
[[codeblock]]
final code here
[[/codeblock]]
.please provide clean, maintainable and accurate code with comments for each method.
`})
                            const codeContent = await this.askgpt(this.chats) as string
                            //let codeBody = this.cleanCodeBlock(codeContent)
                            code = this.getBlockContent(codeContent, 'codeblock') as string
                        }
                        lockFeatureJson['features'][file]['children'].push(f)
                        //const filePath = f as fs.PathOrFileDescriptor
                        this.createFile(f, code!)
                    }// end write respone to file
                }
                await getCodeToFileWithGpt()
                this.chats.push({
                    "role": "user", "content": `Please review the conversation to confirm if you have missed providing any files. If any files have been missed, please provide them again in the agreed format. Otherwise, please respond with the following content: null`
                })//Ask gpt to check the provided files for omissions.
                this.log('check!')
                await getCodeToFileWithGpt()
                // start db migration file
                const dbtype = config['basic']['db']
                if (dbtype && config['db']?.['need_migration_file']) {
                    lockFeatureJson['migration'] = lockFeatureJson['migration'] || []
                    let migFile = await this.createDbMigragitonFile(lockFeatureJson['migration'])
                    if (migFile) {
                        lockFeatureJson['migration'].push(migFile)
                    }
                } // end db migration file
                this.createFile('codellms-lock.json', JSON.stringify(lockFeatureJson))
                await this.createMainfile(config)// updagte main file
            }
        }
        // this.createFile('codellms-lock.json', JSON.stringify(lockFeatureJson))
        // build project , tell project index to gpt if has error
    }
    async createDbMigragitonFile(existDbMigFiles: Array<string>): Promise<string | null> {
        const migFilesPrompt = existDbMigFiles.length > 0 ? `Please refer to the existing database migration files to name this file:${existDbMigFiles};` : 'Does not currently exist migration file.'
        this.chats.push({
            "role": "user",
            "content": `Generate a data migration file based on the data structure for writing to the database as described in the above code. ${migFilesPrompt} please provide it in the following format:
             [[file]]
             insert db migration filen here
             [[/file]]
             [[codeblock]]
             insert db migration content here
             [[/codeblock]];
             otherwise, return the null character in the following format:
             [[file]]
             null
             [[/file]]
             .If you need to include the current time as part of the file name, please use the following time: ${new Date()}.
             Your task is to perform the following actions:
             1. Extract the data structure object according to the operation of the code on the database.
             2. Follow the format of the historical data migration file to get the name of the data migration file.
             3. If this is the first data migration file, you should name the file according to the naming convention of the data migration tool you are currently using.
             4. Generate migration code according to the above format requirements.
             `
        })
        const codeMigContent = await this.askgpt(this.chats) as string
        const migrationFile = this.getBlockContent(codeMigContent, 'file')
        if (migrationFile.trim() != 'null') {
            const dbMigrationCode = this.getBlockContent(codeMigContent, 'codeblock')
            this.createFile(migrationFile, dbMigrationCode)
            return migrationFile.trim()
        }
        return null
    }
    async tryBuildOrStart(debugRetry: number): Promise<void> {

        const ask = { "role": "user", "content": "Please tell me the startup (scripting language) or build (compiled language) command for this project. so that I can run it in the current directory to get a preliminary idea of whether there are any errors .This command hopes that the console will not output warning, and the information you reply will only be executable commands, without any other information. For example, return it like this: RUSTFLAGS=-Awarnings cargo build." }
        this.chats.push(ask)
        let answer = await this.askgpt(this.chats)
        answer = this.getBlockContent(answer!, 'codeblock')
        this.log('build command:', answer)

        let retry = 0
        // Clear context, split steps
        this.chats = []
        this.chats.push({
            "role": "system", "content": 'You are a coding expert, and you can help me solve problems in programming.'
        })
        let lockFeatureJson: { [key: string]: any } = this.getLockFile()
        let featureFiles = this.getClearFeatureFileList(lockFeatureJson)
        const retryAsk = async (err: string) => {
            if (retry > debugRetry)
                return
            retry += 1;
            // ask gpt
            this.chats.push({
                "role": "user", "content": `During program execution, the following error occurred: '${err}' .The files provided for the current project are as follows:${JSON.stringify(featureFiles)}.
                According to the error message, please tell me the file that needs to be modified, and I will tell you its contents. If it is a brand-new file, please put the code in the [[codeblock]] node. I will perform different operations based on whether the [[codeblock]] node is empty. If there are multiple files to modify, only return the first file.No need to explain the modification, just provide me with the correct code.For example:
[[file]]
insert file path here
[[/file]]
[[codeblock]]
insert code here
[[/codeblock]]
`})
            let tryCorretCode = await this.askgpt(this.chats) as string
            let filePath = this.getBlockContent(tryCorretCode, 'file')
            let maybeCorretCode = this.getBlockContent(tryCorretCode, 'codeblock') as string
            if (maybeCorretCode.startsWith('[[file]]')) {//modify
                const codeFile = fs.readFileSync(filePath, 'utf-8')
                this.chats.push({
                    "role": "user",
                    "content": `${filePath} file's code is:
                    [[codeblock]]
                    ${codeFile.toString()}
                    [[/codeblock]]
                    .Check step by step according to the error message and the code you provided, and then provide me with the correct code of this file::
                    [[codeblock]]
                    put correct code here(The code of the entire file, not just the portion of code that was modifie)
                    [[/codeblock]]`
                })
                tryCorretCode = await this.askgpt(this.chats) as string
                maybeCorretCode = this.getBlockContent(tryCorretCode, 'codeblock') as string
            }
            //tryCorretCode = this.cleanCodeBlock(tryCorretCode) as string
            if (filePath) {
                this.createFile(filePath!, maybeCorretCode!)
            }
            await this.execCommand(answer).then(() => exit(1)).catch(retryAsk)

        }

        await this.execCommand(answer).then(() => exit(1)).catch(retryAsk)
    }
}
