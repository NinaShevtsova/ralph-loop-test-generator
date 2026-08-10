@F03
Feature: F-03 Pet visit: recording the entry and the visit history

  A visit is the only entity that can be recorded in two independent ways: from the pet
  details, where the owner and the pet are given in the address, and in the clinic-wide visits
  log, where the pet is given in the request body. A recorded visit is visible in three places:
  in the pet's visit history, in the owner details inside their pet, and in the clinic's
  visits log. The flow verifies that both ways create equivalent records and that the visit is
  displayed identically everywhere.

  @AC-F03-01 @US-05 @US-02
  Scenario: AC-F03-01 a visit from the pet details is visible in the pet's history, in the owner details and in the log
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When a visit is recorded for the pet
    Then the created visit has an assigned id, the submitted values and a link to the pet
    When the visit details are opened
    Then the visit details show the pet link and unchanged data
    When the pet details are opened
    Then the pet details show the recorded visit
    When the owner details are opened
    Then the owner details show the pet and its recorded visit
    When the visits log is requested
    Then the visits log contains exactly one entry for the recorded visit linked to the pet

  @AC-F03-02 @US-05 @US-02
  Scenario: AC-F03-02 a visit from the clinic-wide log lands in the history of the same pet
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When a visit is recorded for the pet
    Then the created visit has an assigned id, the submitted values and a link to the pet
    When a visit is logged directly for the pet
    Then the directly logged visit has an assigned id different from the first visit's and links to the same pet
    When the pet details are opened
    Then the pet details show both recorded visits
    When the visits log is requested
    Then the visits log contains both recorded visits

  @AC-F03-03 @US-05
  Scenario: AC-F03-03 a visit can be scheduled for a future date
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When a visit is recorded for the pet for a future date
    Then the created visit has an assigned id, the submitted values and a link to the pet
    When the visit details are opened
    Then the visit details show the pet link and unchanged data
    When the pet details are opened
    Then the pet details show the recorded visit

  @AC-F03-04 @US-05 @US-02
  Scenario: AC-F03-04 a corrected visit description is visible in the pet's history
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    And a visit is recorded for the pet
    When the visit is updated
    Then the visit update returns an empty body
    When the visit details are opened
    Then the visit details show the pet link and the corrected description
    When the pet details are opened
    Then the pet details show the visit with the corrected description

  @AC-F03-05 @US-01 @US-03
  Scenario: AC-F03-05 a cancelled visit disappears from the history and the log, and cancelling again gives 404
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    And a visit is recorded for the pet
    When the visit is deleted
    When an attempt is made to open the visit details
    Then the visit is reported as not found with an empty body
    When the pet details are opened
    Then the pet details show the pet unaffected with an empty visit history
    When the visits log is requested
    Then the visits log shows no trace of the removed visit
    When the owner details are opened
    Then the owner details show the pet unaffected with an empty visit history
    When the visit is deleted again
    Then the second deletion reports that the visit does not exist

  @AC-F03-06 @US-05 @US-02
  Scenario: AC-F03-06 editing one visit does not affect the pet's remaining visits
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    And a visit is recorded for the pet
    And a second visit is recorded for the pet
    When the visit is updated
    Then the visit update returns an empty body
    When the visit details are opened
    Then the visit details show the pet link and the corrected description
    When the second visit's details are opened
    Then the second visit's own details are unaffected by the first visit's correction
    When the pet details are opened
    Then the pet details show the corrected visit and the untouched second visit
