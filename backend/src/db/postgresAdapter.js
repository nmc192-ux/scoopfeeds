export function createPostgresAdapter() {
  return {
    name: "postgres",
    supportsDualWrite: true,
    jobRuns: {
      insert() {
        throw new Error("Postgres adapter is not implemented yet");
      },
      update() {
        throw new Error("Postgres adapter is not implemented yet");
      },
      listRecentFailed() {
        throw new Error("Postgres adapter is not implemented yet");
      },
    },
  };
}
