@F03
Feature: F-03 Pet visit: recording the entry and the visit history

  A visit is the only entity that can be recorded in two independent ways: from the pet details (the
  owner and the pet are given in the address) and in the clinic-wide visits log (the pet is given in
  the request body). A recorded visit is visible in three places: in the pet's visit history, in the
  owner details (inside their pet) and in the clinic's visits log. The flow verifies that both ways
  create equivalent records and that the visit is displayed identically everywhere.

  @AC-F03-01 @US-05 @US-02
  Scenario: AC-F03-01 a visit from the pet details is visible in the pet's history, in the owner details and in the log
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When a visit is recorded for the pet
    Then the created visit has an assigned id, the submitted values and a link to the pet
    When the visit details are opened
    Then the visit still shows the description and date it was recorded with
    When the pet details are opened
    Then the pet details show the visit that was recorded for it
    When the owner details are opened
    Then the owner details show the pet with its recorded visit
    When the visits log is requested
    Then the visit appears exactly once in the visits list with the pet's id

  @AC-F03-02 @US-05 @US-02
  Scenario: AC-F03-02 a visit from the clinic-wide log lands in the history of the same pet
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When a visit is recorded for the pet
    Then the created visit has an assigned id, the submitted values and a link to the pet
    When a visit is recorded in the clinic log
    Then the visit recorded in the clinic log carries the pet's id and an id distinct from the first visit
    When the pet details are opened
    Then the pet details show both visits recorded for it
    When the visits log is requested
    Then both visits appear in the visits list with the pet's id

  @AC-F03-03 @US-05
  Scenario: AC-F03-03 a visit can be scheduled for a future date
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When a visit is recorded for the pet with a future date
    Then the created visit has an assigned id, the submitted values and a link to the pet
    When the visit details are opened
    Then the visit still shows the description and date it was recorded with
    When the pet details are opened
    Then the pet details show the visit that was recorded for it

  @AC-F03-04 @US-05 @US-02
  Scenario: AC-F03-04 a corrected visit description is visible in the pet's history
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    And a visit is recorded for the pet
    When the visit details are updated
    Then the visit update returns no visit data
    When the visit details are opened
    Then the visit shows the corrected description and an unchanged date
    When the pet details are opened
    Then the pet details show exactly one visit with the corrected description

  @AC-F03-05 @US-01 @US-03
  Scenario: AC-F03-05 a cancelled visit disappears from the history and the log, and cancelling again gives 404
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    And a visit is recorded for the pet
    When the visit is deleted
    Then the visit deletion returns no visit data
    When an attempt is made to open the visit details
    Then the visit details are no longer available
    When the pet details are opened
    Then the pet's own details are unaffected and its visit history is empty
    When the visits log is requested
    Then the visit is missing from the visits list
    When the owner details are opened
    Then the owner details show the pet with an empty visit history
    When the visit is deleted again
    Then the repeated deletion reports that the visit no longer exists

  @AC-F03-06 @US-05 @US-02
  Scenario: AC-F03-06 editing one visit does not affect the pet's remaining visits
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    And a visit is recorded for the pet
    And a second visit is recorded for the pet
    When the visit details are updated
    Then the visit update returns no visit data
    When the visit details are opened
    Then the visit shows the corrected description and an unchanged date
    When the second visit's details are opened
    Then the second visit is unaffected by the first one's edit
    When the pet details are opened
    Then the pet's visit history shows the corrected visit and the untouched one
