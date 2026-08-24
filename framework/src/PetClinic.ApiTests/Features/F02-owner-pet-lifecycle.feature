@F02
Feature: F-02 Owner's pet: adding, changing, deleting

  A pet can be added only through the owner details, while it can be viewed in three places: inside
  the owner details, in its own pet details, and by opening the pet from the owner details. A pet can
  be changed by two different requests, but deleted only directly. The flow verifies that all these
  places show one and the same record rather than independent copies, and that deleting a pet does
  not affect the owner.

  @AC-F02-01 @US-02
  Scenario: AC-F02-01 an added pet is visible in the owner details and in its own details with the same data
    Given an owner is registered
    When the pet types directory is requested
    Then the directory returns at least one pet type
    When a pet is added to the owner
    Then the created pet has an assigned id, the submitted values and a link to the owner
    When the owner details are opened
    Then the owner details show the added pet with the submitted values
    When the pet details are opened
    Then the pet details match the addition and the type from the directory
    When the pet is opened from the owner details
    Then the pet opened from the owner details matches the pet details in every field

  @AC-F02-02 @US-04
  Scenario: AC-F02-02 an added pet appears in the clinic-wide pets list
    Given an owner is registered
    And the pet types directory is requested
    When a pet is added to the owner
    Then the created pet has an assigned id, the submitted values and a link to the owner
    When the pets directory is requested
    Then the pet appears exactly once in the pets list with the submitted values

  @AC-F02-03 @US-02
  Scenario: AC-F02-03 a rename in the pet details is visible in the owner details
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When the pet details are updated
    Then the pet update returns no pet data
    When the owner details are opened
    Then the owner details show the pet with its new name
    When the pet is opened from the owner details
    Then the pet opened from the owner details carries the new name

  @AC-F02-04 @US-02
  Scenario: AC-F02-04 a rename through the owner details is visible in the pet details
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When the pet is updated through the owner
    Then the pet update through the owner details returns no pet data
    When the pet details are opened
    Then the pet details show the name that was set through the owner
    When the owner details are opened
    Then the owner details show the pet with its new name

  @AC-F02-05 @US-02 @US-05
  Scenario: AC-F02-05 editing a pet's data does not wipe the visit history
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    And a visit is recorded for the pet
    When the pet details are opened
    Then the pet details show the visit that was recorded for it
    When the pet details are updated
    Then the pet update returns no pet data
    When the pet details are opened
    Then the pet details show the new name and an unaffected visit history
    When the visit details are opened
    Then the visit still shows the description and date it was recorded with
