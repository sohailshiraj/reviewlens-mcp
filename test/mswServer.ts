import { setupServer } from "msw/node";

/** Shared MSW server instance. Individual test files register handlers via server.use(...). */
export const mswServer = setupServer();
