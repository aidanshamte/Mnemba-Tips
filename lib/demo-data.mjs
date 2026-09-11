const footballers = (prefix, names) => names.map((entry, index) => ({
  id: `${prefix}-${index}`,
  name: entry[0], position: entry[1], form: entry[2], startRate: entry[3], status: entry[4] || "available",
}));

const ballers = (prefix, names) => names.map((entry, index) => ({
  id: `${prefix}-${index}`,
  name: entry[0], position: entry[1], form: entry[2], startRate: entry[3], status: entry[4] || "available",
}));

export const matchups = [
  {
    id: "ars-mci", sport: "soccer", competition: "England · Premier Division", kickoff: "Model scenario",
    home: { name: "Arsenal", short: "ARS", rating: 1874, attack: 87, defense: 85, pace: 0, form: ["W","W","D","W","W"], colors: ["#ef3340","#ffffff"], players: footballers("ars", [["David Raya","GK",82,94],["Ben White","DEF",80,78],["William Saliba","DEF",91,96],["Gabriel","DEF",88,94],["Jurrien Timber","DEF",84,81],["Declan Rice","MID",92,98],["Martin Ødegaard","MID",89,91],["Mikel Merino","MID",80,67],["Bukayo Saka","FWD",95,95],["Kai Havertz","FWD",83,75],["Gabriel Martinelli","FWD",84,72],["Leandro Trossard","FWD",78,48],["Riccardo Calafiori","DEF",77,42,"doubtful"]]) },
    away: { name: "Manchester City", short: "MCI", rating: 1902, attack: 91, defense: 83, pace: 0, form: ["W","L","W","D","W"], colors: ["#6cabdd","#ffffff"], players: footballers("mci", [["Ederson","GK",80,88],["Kyle Walker","DEF",76,65],["Rúben Dias","DEF",88,91],["John Stones","DEF",80,58],["Joško Gvardiol","DEF",90,90],["Rodri","MID",94,93,"unavailable"],["Bernardo Silva","MID",88,89],["Kevin De Bruyne","MID",91,83],["Phil Foden","FWD",93,92],["Erling Haaland","FWD",96,99],["Jérémy Doku","FWD",84,63],["Mateo Kovačić","MID",82,61],["Nathan Aké","DEF",79,52]]) },
    h2h: { games: 10, homeWins: 3, draws: 2, awayWins: 5, recent: ["ARS 1–0 MCI","MCI 0–0 ARS","ARS 1–1 MCI","MCI 4–1 ARS","ARS 1–3 MCI"] },
  },
  {
    id: "rma-bar", sport: "soccer", competition: "Spain · Primera Division", kickoff: "Model scenario",
    home: { name: "Real Madrid", short: "RMA", rating: 1920, attack: 93, defense: 86, pace: 0, form: ["W","W","W","D","W"], colors: ["#f5f5f5","#d4af37"], players: footballers("rma", [["Courtois","GK",89,95],["Carvajal","DEF",83,81],["Rüdiger","DEF",88,94],["Militão","DEF",84,82],["Mendy","DEF",80,74],["Valverde","MID",91,98],["Tchouaméni","MID",86,86],["Bellingham","MID",94,96],["Rodrygo","FWD",88,84],["Mbappé","FWD",96,99],["Vinícius Jr.","FWD",95,97],["Camavinga","MID",84,58]]) },
    away: { name: "Barcelona", short: "BAR", rating: 1886, attack: 92, defense: 80, pace: 0, form: ["W","W","L","W","W"], colors: ["#a50044","#004d98"], players: footballers("bar", [["ter Stegen","GK",84,91],["Koundé","DEF",88,96],["Araújo","DEF",87,85],["Cubarsí","DEF",86,90],["Balde","DEF",84,87],["Pedri","MID",93,94],["de Jong","MID",86,72],["Gavi","MID",88,78],["Lamine Yamal","FWD",97,98],["Lewandowski","FWD",92,94],["Raphinha","FWD",94,95],["Ferran Torres","FWD",79,41,"doubtful"]]) },
    h2h: { games: 10, homeWins: 6, draws: 0, awayWins: 4, recent: ["RMA 3–2 BAR","RMA 4–1 BAR","BAR 1–2 RMA","BAR 0–4 RMA","RMA 0–1 BAR"] },
  },
  {
    id: "bos-lal", sport: "basketball", competition: "USA · Pro Basketball", kickoff: "Model scenario",
    home: { name: "Boston Celtics", short: "BOS", rating: 1768, attack: 121, defense: 116, pace: 99, form: ["W","W","L","W","W"], colors: ["#007a33","#ba9653"], players: ballers("bos", [["Jrue Holiday","G",87,91],["Derrick White","G",90,96],["Jaylen Brown","F",93,98],["Jayson Tatum","F",97,99],["Kristaps Porziņģis","C",89,78],["Al Horford","C",82,51],["Payton Pritchard","G",84,44]]) },
    away: { name: "Los Angeles Lakers", short: "LAL", rating: 1698, attack: 116, defense: 111, pace: 101, form: ["L","W","W","L","W"], colors: ["#552583","#fdb927"], players: ballers("lal", [["D'Angelo Russell","G",83,76],["Austin Reaves","G",88,94],["LeBron James","F",96,98],["Rui Hachimura","F",82,79],["Anthony Davis","C",97,99],["Gabe Vincent","G",75,37],["Jarred Vanderbilt","F",78,31,"doubtful"]]) },
    h2h: { games: 10, homeWins: 7, draws: 0, awayWins: 3, recent: ["BOS 125–121 LAL","LAL 114–105 BOS","LAL 118–125 BOS","BOS 130–108 LAL","LAL 113–121 BOS"] },
  },
  {
    id: "den-gsw", sport: "basketball", competition: "USA · Pro Basketball", kickoff: "Model scenario",
    home: { name: "Denver Nuggets", short: "DEN", rating: 1732, attack: 119, defense: 114, pace: 98, form: ["W","D","W","W","L"], colors: ["#0e2240","#fec524"], players: ballers("den", [["Jamal Murray","G",91,96],["Christian Braun","G",82,84],["Michael Porter Jr.","F",87,94],["Aaron Gordon","F",88,92],["Nikola Jokić","C",99,99],["Russell Westbrook","G",80,42],["Peyton Watson","F",77,35]]) },
    away: { name: "Golden State Warriors", short: "GSW", rating: 1684, attack: 115, defense: 113, pace: 102, form: ["L","W","L","W","W"], colors: ["#1d428a","#ffc72c"], players: ballers("gsw", [["Stephen Curry","G",97,99],["Brandin Podziemski","G",82,78],["Andrew Wiggins","F",84,86],["Draymond Green","F",88,90],["Kevon Looney","C",78,61],["Jonathan Kuminga","F",89,72],["Gary Payton II","G",76,32,"unavailable"]]) },
    h2h: { games: 10, homeWins: 8, draws: 0, awayWins: 2, recent: ["DEN 120–114 GSW","GSW 105–119 DEN","DEN 108–105 GSW","GSW 110–112 DEN","DEN 134–117 GSW"] },
  },
];

export const sources = [
  { name: "OpenFootball", use: "Fixtures, results, teams", license: "Public domain", state: "Connector ready" },
  { name: "StatsBomb Open Data", use: "Soccer events and lineups", license: "Attribution required", state: "Connector ready" },
  { name: "SportsDataverse hoopR", use: "Basketball schedules and play-by-play", license: "CC BY 4.0", state: "Connector ready" },
];
