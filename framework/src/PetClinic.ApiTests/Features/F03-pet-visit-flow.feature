@F03
Feature: F-03 Pet visit: recording the entry and the visit history

  A visit is the only entity that can be recorded in two independent ways: from the pet details (the
  owner and the pet are given in the address) and in the clinic-wide visits log (the pet is given in
  the request body). A recorded visit is visible in three places: in the pet's visit history, in the
  owner details (inside their pet) and in the clinic's visits log. The flow verifies that both ways
  create equivalent records and that the visit is displayed identically everywhere.
