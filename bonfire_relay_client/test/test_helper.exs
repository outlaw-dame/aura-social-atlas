# Tests are fully offline: no module in lib/ performs network I/O, and the
# only federation implementation used is the in-process fake.
ExUnit.start()
