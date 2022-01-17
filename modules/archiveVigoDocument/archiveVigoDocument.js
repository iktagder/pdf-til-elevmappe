const createElevmappe = require("../createElevmappe/createElevmappe");
const getElevmappe = require("../getElevmappe/getElevmappe");
const createMetadata = require("../metadataGenerator/createMetadata");
const p360 = require("../nodep360/p360");
const syncPrivatePerson = require("../syncPrivatePerson/syncPrivatePerson");
const twhError = require("../teamsWebhook/twhError");
const writeLog = require("../writeLog/writeLog");

module.exports = async (vigoData, options) => {

    const p360url = options.P360_URL;
    const p360authkey = options.P360_AUTHKEY;

    const arkiveringsresultat = [];
    const stats = {
        imported: 0,
        addressBlock: 0,
        dispatched: 0,
        manualDispatch: 0,
        error: 0
        // and whatever you like statistics on, update them wherever suitable in the flow, and finally, write them to statfile with writeStat(archiveMethod.metadataSchema, stats)
    }

    for (vigoMelding of vigoData) {
        let createElevmappeBool = false; // For control of creating elevmappe
        let blockedAddress = false; // For control of students blocked address

        writeLog("--- Ny melding: " + vigoMelding.Dokumentelement.DokumentId + " " + vigoMelding.Dokumentelement.Dokumenttype + " ---");
        const statusData = {
            vigoMelding: vigoMelding,
            arkiveringUtfort: false,
            feilmelding: ""
        }

        const documentData = {
            studentBirthnr: vigoMelding.Fodselsnummer,
            documentType: vigoMelding.Dokumentelement.Dokumenttype,
            documentDate: formaterDokumentDato(vigoMelding.Dokumentelement.Dokumentdato),
            schoolAccessGroup: options.P360_CASE_ACCESS_GROUP,
            schoolOrgNr: "506"
        };

        // TODO: Dersom adresse ikke er med i vigo-dokument, finn i vis
        /*let visStudent
        try {
            visStudent = await getElevinfo(documentData.studentBirthnr);
            writeLog("  Fant elev i VIS: " + visStudent.data.navn.fornavn + " " + visStudent.data.navn.etternavn);
        } catch (error) {
            registrerFeilVedArkivering(statusData, `   Error when trying to get student from VIS/FINT for documentid ${vigoMelding.Dokumentelement.DokumentId}`, error, stats);
            continue;
        }*/

        // Update or create private person in p360
        let privatePersonRecno;
        const syncPrivatePersonOptions = {
            url: p360url,
            authkey: p360authkey
        }
        let studentData = {}
        studentData.lastName = vigoMelding.Etternavn;
        studentData.firstName = vigoMelding.Fornavn;
        studentData.streetAddress = vigoMelding.FolkeRegisterAdresse.Adresselinje1; // TODO: adresslinje 2
        studentData.zipCode = vigoMelding.FolkeRegisterAdresse.Postnummmer;
        studentData.zipPlace = vigoMelding.FolkeRegisterAdresse.Poststed;
        studentData.birthnr = documentData.studentBirthnr;

        try {
            privatePersonRecno = await syncPrivatePerson(studentData, syncPrivatePersonOptions);
            // TODO: Bruker vi blokkerte adresser i P360?
            if (privatePersonRecno == "hemmelig") { // Check if address is blocked in 360
                blockedAddress = true
                documentData.parents = []
            }
            writeLog("  Updated or created privatePerson in 360 with fnr: " + documentData.studentBirthnr)
        } catch (error) {
            registrerFeilVedArkivering(statusData, `   Error when trying create or update private person for student for documentid ${vigoMelding.Dokumentelement.DokumentId}`, error, stats);
            continue; // gå til neste melding fra vigokøen
        }

        // get elevmappe and add caseNumber to documentData
        const studentFolderOptions = {
            url: p360url,
            authkey: p360authkey
        }
        try {
            const studentFolderRes = await getElevmappe(documentData.studentBirthnr, studentFolderOptions); // returns false if elevmappe was not found
            if (!studentFolderRes) {
                createElevmappeBool = true;
                writeLog("  Could not find elevmappe - will try to create new elevmappe");
            }
            else {
                documentData.elevmappeCaseNumber = studentFolderRes.CaseNumber; // Found elevmappe for student
                documentData.elevmappeAccessGroup = studentFolderRes.AccessGroup
                documentData.elevmappeStatus = studentFolderRes.Status
                writeLog("  Found elevmappe with case number: " + studentFolderRes.CaseNumber);
            }
        } catch (error) {
            // maybe implement retry function or something here
            registrerFeilVedArkivering(statusData, `   Error when trying to find elevmappe for documentid ${vigoMelding.Dokumentelement.DokumentId}`, error, stats);
            continue; // gå til neste melding fra vigokøen
        }

        // Create elevmappe if needed
        if (createElevmappeBool) {
            writeLog("  Trying to create new elevmappe for student: " + documentData.studentBirthnr);
            const createElevmappeOptions = {
                url: p360url,
                authkey: p360authkey
            }

            let elevmappe;
            try {
                elevmappe = await createElevmappe(studentData, createElevmappeOptions);
                documentData.elevmappeCaseNumber = elevmappe;
            } catch (error) {
                registrerFeilVedArkivering(statusData, ` Error when trying create elevmappe for documentid ${vigoMelding.Dokumentelement.DokumentId}`, error, stats);
                continue; // gå til neste melding fra vigokøen
            }
        }

        if (vigoMelding.Dokumentelement.Dokumenttype !== "SOKER_N") {
            if (documentData.elevmappeStatus === 'Avsluttet') {
                registrerFeilVedArkivering(statusData,
                    `  Kan ikke arkivere dokument til avsluttet elevmappe: ${documentData.elevmappeCaseNumber}`,
                    `Elevmappe: ${documentData.elevmappeCaseNumber}`,
                    stats
                );
                continue; // gå til neste melding fra vigokøen
            }

            documentData.pdfFileBase64 = vigoMelding.Dokumentelement.Dokumentfil;
            documentData.studentName = vigoMelding.Fornavn + " " + vigoMelding.Etternavn
            // Create 360 metadata object
            let p360metadata;
            try {
                p360metadata = await createMetadata(documentData);

                if (blockedAddress) {
                    p360metadata.Status = "J"
                    p360metadata.Contacts[1].DispatchChannel = "recno:2"
                }
            } catch (error) {
                registrerFeilVedArkivering(statusData, `Error when trying create metadata for documentid ${vigoMelding.Dokumentelement.DokumentId}`, error, stats);
                continue; // gå til neste melding fra vigokøen
            }

            //archive document to p360
            let archiveRes;
            const archiveOptions = {
                url: p360url,
                authkey: p360authkey,
                service: "DocumentService",
                method: "CreateDocument"
            }

            try {
                // Alle dokumenter til elever med hemmelig adresse arver tilgangsgruppe fra elevmappen
                if (documentData.elevmappeAccessGroup && documentData.elevmappeAccessGroup.startsWith("SPERRET")) {
                    p360metadata.AccessGroup = documentData.elevmappeAccessGroup
                }
                archiveRes = await p360(p360metadata, archiveOptions); // FEILIER IKKE NØDVENDIGVIS MED FEIL METADATA
                if (archiveRes.Successful) {
                    documentNumber = archiveRes.DocumentNumber;
                    writeLog(`  Document archived with documentNumber ${archiveRes.DocumentNumber}`);
                    statusData.arkiveringUtfort = true;
                    stats.imported++
                }
                else {
                    throw Error(archiveRes.ErrorMessage) // TODO, ikke kast feil, men håndter det slik at vi kan melde fra til teams/vigo
                }
            } catch (error) {
                registrerFeilVedArkivering(statusData, `  Error when trying to archive Vigo documentid ${vigoMelding.Dokumentelement.DokumentId}  to P360`, error, stats)
                continue; // gå til neste melding fra vigokøen
            }
            arkiveringsresultat.push(statusData);
        }
    };
    return arkiveringsresultat;
}

// P360 vil ha YYYY-MM-DD
function formaterDokumentDato(datostreng) {
    const d = new Date(Date.parse(datostreng));
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function registrerFeilVedArkivering(statusData, feilBeskrivelse, error, stats) {
    writeLog(`${feilBeskrivelse} ${error}`);
    stats.error++;
    statusData.feilmelding = error;
    await twhError(feilBeskrivelse, error);
    arkiveringsresultat.push(statusData);
}