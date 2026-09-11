import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const dataSources = sqliteTable("data_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sport: text("sport").notNull(),
  license: text("license").notNull(),
  sourceUrl: text("source_url").notNull(),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
}, (table) => [uniqueIndex("idx_data_sources_name").on(table.name)]);

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  sourceId: integer("source_id").references(() => dataSources.id),
  sport: text("sport").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  competition: text("competition"),
  rating: real("rating").default(1500).notNull(),
}, (table) => [uniqueIndex("idx_teams_source_external").on(table.sourceId, table.externalId), index("idx_teams_sport_name").on(table.sport, table.name)]);

export const players = sqliteTable("players", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  teamId: integer("team_id").references(() => teams.id),
  name: text("name").notNull(),
  position: text("position"),
  availability: text("availability").default("unknown").notNull(),
  formRating: real("form_rating").default(50).notNull(),
}, (table) => [index("idx_players_team").on(table.teamId), uniqueIndex("idx_players_team_external").on(table.teamId, table.externalId)]);

export const matches = sqliteTable("matches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  sourceId: integer("source_id").references(() => dataSources.id),
  sport: text("sport").notNull(),
  competition: text("competition"),
  startsAt: integer("starts_at", { mode: "timestamp" }),
  status: text("status").default("scheduled").notNull(),
  homeTeamId: integer("home_team_id").references(() => teams.id),
  awayTeamId: integer("away_team_id").references(() => teams.id),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
}, (table) => [uniqueIndex("idx_matches_source_external").on(table.sourceId, table.externalId), index("idx_matches_teams_date").on(table.homeTeamId, table.awayTeamId, table.startsAt), index("idx_matches_sport_date").on(table.sport, table.startsAt)]);

export const appearances = sqliteTable("appearances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: integer("match_id").references(() => matches.id).notNull(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  teamId: integer("team_id").references(() => teams.id).notNull(),
  started: integer("started", { mode: "boolean" }).default(false).notNull(),
  minutes: integer("minutes").default(0).notNull(),
  performanceRating: real("performance_rating"),
}, (table) => [uniqueIndex("idx_appearances_match_player").on(table.matchId, table.playerId), index("idx_appearances_player_match").on(table.playerId, table.matchId)]);

export const predictions = sqliteTable("predictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: integer("match_id").references(() => matches.id),
  modelVersion: text("model_version").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [index("idx_predictions_match_created").on(table.matchId, table.createdAt)]);
