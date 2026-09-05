# Frontend visual checks

Screenshots use mocked authentication and market data. They do not represent a live treasury or actual trading results.

Run with the frontend listening at localhost:3100:

    node artifacts/check-frontend.cjs

Requires Playwright and Microsoft Edge. Checks overview, strategy zones, activity, events, token validation, running controls, populated balances, sign out, browser errors, and mobile overflow. All API requests and market WebSocket messages are intercepted in the test browser.

Design reference: https://carbondesignsystem.com/data-visualization/dashboards/
