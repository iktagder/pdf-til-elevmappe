const config = require("./config");
const writeLog = require("./modules/writeLog/writeLog");
const twhError = require("./modules/teamsWebhook/twhError");

const karakterutskrift = require("./archiveMethods/karakterutskrift");
const opprettElevmapper = require("./archiveMethods/opprettElevmapper");
const { TEST_ENV } = require("./config");
const vigoDocuments = require("./archiveMethods/vigoDocuments");

//run main program
(async () => {
    writeLog(" - - - STARTING SCRIPT - - - ");

    const argumenter = process.argv.slice(2);
    if (argumenter.length === 0) {
        console.log("Ingen argumenter gitt. Mulige valg:\n'-v': kjører arkivering av vigo-dokumenter\n'-k': arkiverer pdf-karakterutskrifter\n'-o': oppretter elevmappe og kontakt basert på innhold i csv-mappe");
        return;
    }

    if (argumenter.includes('-v') || argumenter.includes('--vigo')) {
        console.log("Kjører arkivering av dokumenter fra vigo-kø");
        try {
            await vigoDocuments(config);
        } catch (error) {
            writeLog("Error when running vigoDocuments: " + error);
            await twhError("Error when running vigoDocuments", error, config.DISPATCH_FOLDER)
        }
    }
    if (argumenter.includes('-k' || argumenter.includes('--karakterutskrift'))) {
        writeLog("Kjører karakterutskrift");
        try {
            await karakterutskrift(config, TEST_ENV);
        } catch (error) {
            writeLog("Error when running karakterutskrift: " + error);
            await twhError("Error when running karakterutskrift", error, config.DISPATCH_FOLDER)
        }
    }
    if (argumenter.includes('-o') || argumenter.includes('--opprettElevmapper')) {
        console.log("Oppretter kontakt og elevmappe");
        try { // Synkroniserer kun kontakt og elevmappe. Arkiverer ikke dokument. Leser fnr, navn, adresse fra CSV-fil.
            await opprettElevmapper(config, TEST_ENV);
        } catch (error) {
            writeLog("Error when running opprettElevmapper: " + error);
            await twhError("Error when running opprettElevmapper", error, config.DISPATCH_FOLDER)
        }
    }
})();
