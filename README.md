# Lunch Orders

A small lunch-ordering app for a team of up to 10 people.

## Run it

Requires Node.js 22.5 or newer. There's nothing to install.

```
npm start
```

Then open http://localhost:3000.

## How it works

- **Create account**: anyone can sign up until the 10 spots are filled. The **first** person to sign up becomes the admin.
- **Log in / out**: sessions last 7 days.
- **Order**: each person picks one menu item (with a quantity and notes) per day, and can change or cancel it.
- **Team view**: shows everyone's orders for today, the total cost, and a per-item summary to send to the restaurant.
- **Admin**: can add and remove menu items.

Data is stored in `lunch.db` (SQLite). Delete that file to start over.
Set the `MAX_USERS` or `PORT` environment variables to change the defaults.
