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
