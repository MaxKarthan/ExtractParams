import * as fs from "fs";
import * as readline from "readline";
import events from "events";

interface InputArgs{
    txt: string;
    csv: string;
    output: string;
}

//Index shift from start to end for consecutive parameters
const CONSECUTIVE_PARAMS_INDEX_SHIFT = 4;

function getInputArgs(): InputArgs{
    const args = process.argv.slice(2);
    const output = args.find(arg => arg.startsWith('output='))?.substring(7);
    const csv = args.find(arg => arg.startsWith('csv='))?.substring(4);
    const txt = args.find(arg => arg.startsWith('txt='))?.substring(4);

    if(!output){
        console.log("Path for output file is missing! Example: extract.exe output=./path/to/file.txt");
    }
    if(!csv){
        console.log("Path for CSV file is missing! Example: extract.exe csv=./path/to/file.csv");
    }
    if(!txt){
        console.log("Path for source file is missing! Example: extract.exe txt=./path/to/file.txt");
    }
    if(!output || !csv || !txt){
        process.exit(2);
    }
    return{
        output,
        csv,
        txt
    }
}

async function readFile(path: string) {
    const fileContent: string[] = [];
    const rl = readline.createInterface({
        input: fs.createReadStream(path, {encoding: 'utf-8'})
    });

    rl.on('line', (line) => {
        fileContent.push(line);
    })

    await events.once(rl, 'close');
    return fileContent;
}

/**
 * Check the remaining source file if there are any more occurrences of the currently searched parameter.
 * @param tmpIndex
 * @param txtContent
 * @param csvContent
 * @param csvIndex
 */
function findMoreParameterOccurrence(tmpIndex: number, txtContent: string[], csvContent: string[], csvIndex: number) {
    let foundEnd = true;
    const parameterNameWithX = csvContent[csvIndex + 3];
    const parameterName = parameterNameWithX.substring(0, parameterNameWithX.length - 1);

    for (let searchIndex = tmpIndex + 1; searchIndex < txtContent.length; searchIndex++) {
        const currentSearchedLine = txtContent[searchIndex];

        if (currentSearchedLine.includes(parameterName)) {
            foundEnd = false;
        }
    }
    return foundEnd;
}

/**
 * For consecutive multiline parameters.
 * If end is defined with X write all parameter occurrences to output file, otherwise just to the defined number.
 * Consecutive parameters have to be defined in the format shown in the example below
 *
 * @example PARAMETER_NAME0
 *          PARAMETER_NAME0 # END
 *          ...
 *          PARAMETER_NAME5
 *          PARAMETER_NAME5 # END
 *
 *          PARAMETER_NAME0
 *          PARAMETER_NAME0 # END
 *          ...
 *          PARAMETER_NAMEX
 *          PARAMETER_NAMEX # END
 * @param txtIndex
 * @param txtContent
 * @param csvContent
 * @param csvIndex
 * @param output
 */
function handleConsecutiveMultilineParameters(txtIndex: number, txtContent: string[], csvContent: string[], csvIndex: number, output: string[]) {
    let tmpIndex = txtIndex + 1;
    let foundEnd = false;
    //copy all following lines from the source txtfile to the output file until we reach the parameter
    //specified as 'end' or, if the end is open, until there are no more occurrences of the parameter
    while (!foundEnd && tmpIndex < txtContent.length) {
        const parameterName = csvContent[csvIndex + (CONSECUTIVE_PARAMS_INDEX_SHIFT - 1)].trim();
        const endsWithX = parameterName.endsWith('X');

        const currentTxtFileLine = txtContent[tmpIndex];
        //if end is specified by number and this number is reached then stop.
        if (!endsWithX && currentTxtFileLine.includes(csvContent[csvIndex + CONSECUTIVE_PARAMS_INDEX_SHIFT])) {
            foundEnd = true;
            csvIndex += CONSECUTIVE_PARAMS_INDEX_SHIFT;
        }
        //if end is not specified (X): as we find an END tag check if there are more occurrences of the parameter
        //in the source file if so continue otherwise stop.
        else if (endsWithX && currentTxtFileLine.includes('END')) {
            foundEnd = findMoreParameterOccurrence(tmpIndex, txtContent, csvContent, csvIndex);
            if (foundEnd) {
                csvIndex += CONSECUTIVE_PARAMS_INDEX_SHIFT;
            }
        }
        output.push(txtContent[tmpIndex]);
        tmpIndex++;
    }
    return csvIndex;
}

/**
 * For multiline parameters, add all following lines of source txt file to output until we reach an END tag in the source file.
 *
 * @example PARAMETER_NAME0
 *          PARAMETER_NAME0 # END
 * @param txtIndex start index of multiline parameter in source txt file
 * @param txtContent the content of the source txt file as string array
 * @param output
 */
function handleMultilineParameters(txtIndex: number, txtContent: string[], output: string[]) {
    let tmpIndex = txtIndex + 1;
    while (tmpIndex < txtContent.length) {
        if (txtContent[tmpIndex].includes('END')) {
            break;
        }
        output.push(txtContent[tmpIndex]);
        tmpIndex++;
    }
}

/**
 * Check if the parameter name ends with a number which means it is a consecutive parameter.
 *
 * @example PARAMETER_NAME0
 *          PARAMETER_NAME0 # END
 *          ...
 *          PARAMETER_NAME5
 *          PARAMETER_NAME5 # END
 * @param parameterName
 */
function isConsecutiveParameter(parameterName: string) {
    const endsWithNumberRegex = /\d$/;

    return endsWithNumberRegex.test(parameterName.trim());
}

function isMultilineParameter(csvContent: string[], csvIndex: number) {
    return csvContent.length > csvIndex + 1 &&
        csvContent[csvIndex + 1].includes('END');
}

/**
 * Entrypoint for the script
 */

console.log("Starting parameter extraction...");
const inputArgs: InputArgs = getInputArgs();
(async function processInputByLine() {

    const csvContent = await readFile(inputArgs.csv);
    const txtContent = await readFile(inputArgs.txt);

    const output: string[] = [];

    for (let csvIndex = 0; csvIndex < csvContent.length; csvIndex++) {
        const csvLine = csvContent[csvIndex];

        /*
            check if the csv line is a comment and if so just add the comment to the output file
            and skip the handling of this line
        */
        if (csvLine.startsWith('#')) {
            output.push(csvLine);
            continue;
        }

        for (let txtIndex = 0; txtIndex < txtContent.length; txtIndex++) {
            const line = txtContent[txtIndex];
            /*
                if the current line in the source txtFile contains the parameter of the csvLine
                add this line to the output txtFile
             */
            if (line.includes(csvLine)) {
                output.push(line);

                /*
                    check if the next csvLine contains an END tag.
                    If so, check if it is a consecutive parameter
                    or not and call the corresponding method.
                 */
                if (isMultilineParameter(csvContent, csvIndex)) {
                    if (isConsecutiveParameter(csvLine)) {
                        csvIndex = handleConsecutiveMultilineParameters(txtIndex, txtContent, csvContent, csvIndex, output);
                    } else {
                        handleMultilineParameters(txtIndex, txtContent, output);
                    }
                }
                break;
            }

        }
    }

    //write to output file
    const outputFile = fs.createWriteStream(inputArgs.output);
    output.forEach(line => outputFile.write(line + '\n'));
    console.log(`Successfully extracted all parameters in ${inputArgs.csv} from ${inputArgs.txt} to ${inputArgs.output}`);
})();


