import { Hono } from "hono";
import { cors } from 'hono/cors';
import { setupRoutes } from "./routes";

export interface ApiEnv {
    DB: D1Database;
    API_KEY?: string;
    SCRAPER_API_KEY?: string;
}

const app = new Hono<{ Bindings: ApiEnv }>();

app.use('*', cors());

setupRoutes(app);

export default {
    fetch(request: Request, env: ApiEnv, ctx: ExecutionContext) {
        return app.fetch(request, env, ctx);
    }
};
