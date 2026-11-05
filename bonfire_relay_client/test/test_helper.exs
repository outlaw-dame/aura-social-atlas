# Tests are offline. The only federation implementation used is the
# in-process fake; the optional :pg suite talks to a loopback PostgreSQL only
# when RELAY_CLIENT_PG_URL is set.
exclude = if System.get_env("RELAY_CLIENT_PG_URL"), do: [], else: [:pg]
ExUnit.start(exclude: exclude)
