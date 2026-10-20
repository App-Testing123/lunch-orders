# Lunch Orders

A small lunch-ordering app for a team of up to 10 people.

## How it works

- **Create account**: anyone can sign up until the 10 spots are filled. The **first** person to sign up becomes the admin.
- **Log in / out**: sessions last 7 days.
- **Order**: each person picks one menu item (with a quantity and notes) per day, and can change or cancel it.
- **Team view**: shows everyone's orders for today, the total cost, and a per-item summary to send to the restaurant.
- **Admin**: can add and remove menu items.

## Put it online (free): Render + Neon

1. **Database**: sign up at https://neon.tech, create a project, and copy its **connection string**
   (it looks like `postgresql://user:password@ep-xxx.neon.tech/neondb?sslmode=require`).
2. **App**: sign up at https://render.com with your GitHub account, then click
   **New → Blueprint** and pick this repository. Render reads `render.yaml`.
3. When it asks for `DATABASE_URL`, paste the Neon connection string and click **Apply**.
4. After a few minutes your app is live at `https://lunch-orders-xxxx.onrender.com`. Share that link with the team.

The free Render plan sleeps after 15 minutes without visitors, so the first visit after a quiet spell takes about 30 seconds to load.
Every push to `main` redeploys the app automatically.

## Run it locally

Requires Node.js 20 or newer.

```
npm install
npm start
```

Then open http://localhost:3000. Without `DATABASE_URL`, data is kept in a local `pgdata/` folder (delete it to start over).

## Settings (environment variables)

| Variable       | Default            | Meaning                                         |
| -------------- | ------------------ | ----------------------------------------------- |
| `DATABASE_URL` | local `pgdata/`    | Postgres connection string                      |
| `TIMEZONE`     | server's time zone | Decides when "today" starts, e.g. `Asia/Singapore` |
| `MAX_USERS`    | `10`               | How many accounts can be created                |
| `PORT`         | `3000`             | Port to listen on                               |
