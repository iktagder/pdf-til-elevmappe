const getPdfsInFolder = require("../getPdfsInFolder/getPdfsInFolder");
const writeLog = require("../writeLog/writeLog");
const writeStat = require("../writeLog/writeStat");
const { lesPdfInnhold } = require("../archiveFunctions/lesPdfInnhold");
const {
  strukturerPdfInnhold,
} = require("../archiveFunctions/strukturerPdfInnhold");
const {
  hentEllerOpprettElevmappe,
} = require("../archiveFunctions/hentEllerOpprettElevmappe");
const { genererMetadata } = require("../archiveFunctions/genererMetadata");
const { arkiverDokument } = require("../archiveFunctions/arkiverDokument");
const meldFeil = require("../archiveFunctions/meldFeil");
const { hentElevinfoP360 } = require("../archiveFunctions/hentElevinfoP360");

module.exports = async (archiveMethod, config) => {
  const baseP360Options = {
    url: config.P360_URL,
    authkey: config.P360_AUTHKEY,
  };

  const stats = {
    imported: 0,
    documents: 0,
    error: 0,
    // and whatever you like statistics on, update them wherever suitable in the flow, and finally, write them to statfile with writeStat(archiveMethod.metadataSchema, stats)
  };

  try {
    const listOfPdfs = getPdfsInFolder(archiveMethod.inputFolder);
    if (listOfPdfs.length === 0) {
      meldFeil(
        "Feil ved lesing av input-mappe",
        `Ingen ${archiveMethod.name} i import-mappen ${archiveMethod.inputFolder}`,
        archiveVisDocument,
        null
      );
      return;
    }

    // TODO, legg til teller og ta i bruk archiveMethod.maksAntallDokumenter
    //mainLoop -- alle funksjonskall returnerer null ved feil
    for (const pdf of listOfPdfs) {
      writeLog(`--- ${archiveMethod.name}, ny fil: " ${pdf} " ---`);
      if (stats.imported + stats.error >= archiveMethod.maksAntallDokumenter) {
        return; // finally vil fremdeles kjøre, så stats blir skrevet til disk
      }

      const pdfContent = await lesPdfInnhold(pdf, archiveMethod);
      if (!pdfContent) {
        stats.error++;
        continue;
      }

      const documentData = await strukturerPdfInnhold(
        pdfContent,
        archiveMethod
      );
      if (!documentData) {
        stats.error++;
        continue;
      }

      // Finn student i P360
      const studentInfo = await hentElevinfoP360(
        documentData.studentBirthnr,
        archiveMethod,
        baseP360Options,
      );
      
      
      if (!studentInfo) {
        stats.error++;
        continue;
      } else {
        documentData.studentName = `${studentInfo.navn.fornavn} ${studentInfo.navn.etternavn}`;
      }
      // syncPrivatePerson -> privatePersonRecno (oppdaterer og verifiserer at personen er registrert i p360)
      // Vi henter nå studentInfo fra P360, så ikke vits å oppdatere....
      const studentRecno = studentInfo.recno;

      if (!studentRecno) {
        stats.error++;
        continue;
      }

      // get elevmappe and add caseNumber to documentData
      const elevmappe = await hentEllerOpprettElevmappe(
        studentInfo,
        documentData.studentBirthnr,
        archiveMethod,
        pdf,
        baseP360Options
      );
      if (!elevmappe) {
        stats.error++;
        continue;
      } else {
        documentData.elevmappeCaseNumber = elevmappe.elevmappeCaseNumber;
        documentData.elevmappeAccessGroup = elevmappe.elevmappeAccessGroup;
        documentData.elevmappeStatus = elevmappe.elevmappeStatus;
      }

      if (
        documentData.elevmappeStatus === "Avsluttet" ||
        documentData.elevmappeStatus === "Utgår"
      ) {
        meldFeil(
          {},
          `Kan ikke lagre til avsluttet mappe nr ${documentData.elevmappeCaseNumber}`,
          archiveMethod,
          pdf
        );
        stats.error++;
        continue;
      } else {
        const metadata = await genererMetadata(
          documentData,
          pdf,
          archiveMethod
        );
        if (!metadata) {
          stats.error++;
          continue;
        }
        const arkivnummer = await arkiverDokument(
          metadata,
          archiveMethod,
          pdf,
          baseP360Options
        );
        if (arkivnummer) {
          stats.imported++;
          writeLog(
            `Document archived with documentNumber ${arkivnummer}`
          );
        } else {
          stats.error++;
        }
      }
    }
  } catch (error) {
    writeLog(error);
  } finally {
    await writeStat(archiveMethod.metadataSchema, stats);
  }
};
