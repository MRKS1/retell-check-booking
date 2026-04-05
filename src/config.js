const CONFIG = {
  timezone: "Europe/Bratislava",
  calendarProvider: process.env.CALENDAR_PROVIDER || "sqlite",
  businessHours: {
    monday: ["07:00", "15:00"],
    tuesday: ["07:00", "15:00"],
    wednesday: ["07:00", "15:00"],
    thursday: ["07:00", "15:00"],
    friday: ["07:00", "15:00"],
    saturday: null,
    sunday: null
  },
  defaultDurationMinutes: 10,
  slotIntervalMinutes: 10,
  maxSuggestions: 5,
  availabilitySearchDays: 30,

  services: {
    sportova_prehliadka: {
      label: "Športová prehliadka",
      timeWindows: [["07:00", "08:40"]],
      durationMinutes: 20,
      intervalMinutes: 20,
      maxPerDay: null,
      patientInfo: "Musíte prísť nalačno – bude vám odoberaná krv aj moč. Doneste si jedlo, vodu, športové oblečenie a uterák. Samotné vyšetrenie trvá 40–60 minút, takže ak máte neskoršie poradové číslo, môžete si medzitým odskočiť."
    },
    vstupne_vysetrenie: {
      label: "Vstupné vyšetrenie",
      timeWindows: [["09:00", "12:00"]],
      durationMinutes: 10,
      intervalMinutes: 10,
      maxPerDay: null,
      patientInfo: "Prineste si výmenný lístok od lekára, kartičku poistenca a zdravotnú kartu. Ak vám bolo robené zobrazovacie vyšetrenie, doneste aj správu alebo CD."
    },
    kontrolne_vysetrenie: {
      label: "Kontrolné vyšetrenie",
      timeWindows: [["13:00", "14:40"]],
      durationMinutes: 10,
      intervalMinutes: 10,
      maxPerDay: null,
      patientInfo: "Doneste si dekurz, ktorý ste dostali na vstupnom vyšetrení."
    },
    zdravotnicka_pomocka: {
      label: "Predpis zdravotníckej pomôcky",
      timeWindows: [["09:00", "12:00"], ["13:00", "14:40"]],
      durationMinutes: 10,
      intervalMinutes: 10,
      maxPerDay: 1,
      patientInfo: "Predpis zdravotníckej pomôcky."
    },
    konzultacia: {
      label: "Konzultácia",
      timeWindows: [["14:40", "15:00"]],
      durationMinutes: 10,
      intervalMinutes: 10,
      maxPerDay: null,
      patientInfo: "Konzultácia je platená služba (30 €) – expresný termín k lekárovi, ak nie je voľné vstupné vyšetrenie."
    }
  }
};

module.exports = { CONFIG };
