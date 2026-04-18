function getMonthDay(dateString) {
  const date = new Date(`${dateString}T12:00:00+02:00`);
  return {
    month: date.getMonth() + 1,
    day: date.getDate(),
    weekday: date.getDay(),
  };
}

function getDateSignals(dateString) {
  const { month, day, weekday } = getMonthDay(dateString);
  const signals = [];

  if (month === 4 && day === 21) {
    signals.push({
      id: "natale-di-roma",
      title: "Natale di Roma",
      note:
        "21 april: Rom firar sin födelsedag. Välj gärna en rutt med kultur, historisk tyngd eller kvällspuls runt Centro, Aventinen och Trastevere.",
      vibeTags: ["kultur", "klassiker", "kväll"],
    });
  }

  if (month >= 6 && month <= 9) {
    signals.push({
      id: "estate-romana",
      title: "Sommarkväll i Rom",
      note:
        "Sommarsäsongen gör kvällar starkare än mitt på dagen. Utsikter, aperitivo och sena stopp väger därför lite tyngre.",
      vibeTags: ["sommar", "aperitivo", "kväll"],
    });
  }

  if (weekday === 5 || weekday === 6) {
    signals.push({
      id: "weekend-pulse",
      title: "Helgpuls",
      note:
        "Fredag och lördag ger mer drag i barer och torg. Boka populära cocktail- och pizzastopp i god tid om de är kvällsankare.",
      vibeTags: ["nattliv", "bokning", "barer"],
    });
  }

  return signals;
}

module.exports = {
  getDateSignals,
};
