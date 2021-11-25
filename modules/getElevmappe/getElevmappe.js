const p360 = require("../nodep360/p360");

module.exports = async (birthnr, options) => {
    // Legg inn throw error når parameter mangeler
    const elevmappeOptions = {
        url: options.url,
        authkey: options.authkey,
        service: "CaseService",
        method: "GetCases"
    }
    const payload = {
        "ArchiveCode": "B31",
        "ContactReferenceNumber": String(birthnr)
    }
    const elevmappeRes = await p360(payload, elevmappeOptions); // Returns false if elevmappe does not exist
    if (elevmappeRes.Successful) {
        if (elevmappeRes.TotalCount === 0) {
            return false;
        }
        else {
            let activeCases = [];
            for (elevmappe of elevmappeRes.Cases) {
                if (elevmappe.Status !== "Utgår") { // TODO: Hva er poenget med denne koden egentlig? Har vi et status som heter Utgår?
                    activeCases.push(elevmappe);
                }
            }
            if (activeCases.length === 1) {
                return activeCases[0]; // success here, else Error
            }
            else if (activeCases.length === 0) {
                return false; // Has only deactived elevmapper
            }
            else {
                throw Error("Student has several active elevmapper");
            }
        }
    }
    else {
        throw Error(elevmappeRes.ErrorMessage);
    }
}