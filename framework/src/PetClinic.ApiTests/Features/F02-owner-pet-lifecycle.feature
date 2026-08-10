@F02
Feature: F-02 Owner's pet: adding, changing, deleting

  A pet can be added only through the owner details, while it can be viewed in three places:
  inside the owner details, in its own pet details, and by opening the pet from the owner
  details. A pet can be changed by two different requests, but deleted only directly. The flow
  verifies that all these places show one and the same record rather than independent copies,
  and that deleting a pet does not affect the owner.

  @AC-F02-01 @US-02
  Scenario: AC-F02-01 an added pet is visible in the owner details and in its own details with the same data
    Given an owner is registered
    When the pet types directory is requested
    Then the directory returns at least one pet type
    When a pet is added to the owner
    Then the created pet has an assigned id, the submitted values and a link to the owner
    When the owner details are opened
    Then the owner details show one pet matching the added pet's data
    When the pet details are opened
    Then the pet details match the added pet's data and the pet type from the directory
    When the pet is opened from the owner details
    Then the pet from the owner details matches the pet's own details in every field

  @AC-F02-02 @US-04
  Scenario: AC-F02-02 an added pet appears in the clinic-wide pets list
    Given an owner is registered
    And the pet types directory is requested
    When a pet is added to the owner
    Then the created pet has an assigned id, the submitted values and a link to the owner
    When the pets list is requested
    Then the pets list contains exactly one entry for the added pet with the submitted values and its owner link

  @AC-F02-03 @US-02
  Scenario: AC-F02-03 a rename in the pet details is visible in the owner details
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When the pet's own details are updated
    Then the pet update returns an empty body
    When the owner details are opened
    Then the owner details show the pet with the new name
    When the pet is opened from the owner details
    Then the pet from the owner details shows the new name

  @AC-F02-04 @US-02
  Scenario: AC-F02-04 a rename through the owner details is visible in the pet details
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When the pet is updated through the owner's details
    Then the pet update returns an empty body
    When the pet details are opened
    Then the pet details show the new name
    When the owner details are opened
    Then the owner details show the pet with the new name

  @AC-F02-05 @US-02 @US-05
  Scenario: AC-F02-05 editing a pet's data does not wipe the visit history
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    And a visit is recorded for the pet
    When the pet details are opened
    Then the pet details show the recorded visit
    When the pet's own details are updated
    Then the pet update returns an empty body
    When the pet details are opened
    Then the pet details show the new name
    And the pet details show the recorded visit
    When the visit details are opened
    Then the visit details show the pet link and unchanged data

  @AC-F02-06 @US-02 @US-04
  Scenario: AC-F02-06 deleting one pet does not affect the owner's second pet
    Given an owner is registered
    And the pet types directory is requested
    When a pet is added to the owner
    Then the created pet has an assigned id, the submitted values and a link to the owner
    When a second pet is added to the owner
    Then the second pet has an assigned id different from the first pet's
    When the owner details are opened
    Then the owner details show both pets with their own distinct names
    When the pet is deleted
    When the owner details are opened
    Then the owner details show only the second pet, unaffected by the first pet's deletion
    When the second pet's details are opened
    Then the second pet's own details have not changed after the first pet was deleted

  @AC-F02-07 @US-01 @US-03 @US-04
  Scenario: AC-F02-07 a deleted pet cannot be opened in its own details or from the owner details
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    When the pet is deleted
    When an attempt is made to open the pet details
    Then the pet is reported as not found with an empty body
    When an attempt is made to open the pet from the owner details
    Then the pet is reported as not found from the owner details too
    When the owner details are opened
    Then the owner details show the previous contact info and an empty pets list
    When the pets list is requested
    Then the pets list has no entry for the deleted pet

  @AC-F02-08 @US-03
  Scenario: AC-F02-08 a pet cannot be opened through another owner's details
    Given an owner is registered
    And the pet types directory is requested
    And a pet is added to the owner
    And a second owner is registered
    When the pet is opened from the owner details
    Then the pet from the owner details belongs to its own owner
    When an attempt is made to open the pet from the second owner's details
    Then the pet is reported as not found from the second owner's details too

  @AC-F02-09 @US-06
  Scenario: AC-F02-09 a pet cannot be added to a non-existent owner
    Given an owner is registered
    And the pet types directory is requested
    And the owner is deregistered
    When an attempt is made to add a pet to the deleted owner
    Then the pet is reported as not found for the deleted owner
    When the pets list is requested
    Then the pets list has no entry for the pet that was never added

  @AC-F02-10 @US-03
  Scenario: AC-F02-10 deleting a pet removes the visits but preserves the owner and the pet types directory
    Given a new pet type is added to the directory
    And an owner is registered
    And a pet is added to the owner
    And a visit is recorded for the pet
    When the pet is deleted
    When an attempt is made to open the pet details
    Then the pet is reported as not found with an empty body
    When an attempt is made to open the visit details
    Then the visit is reported as not found with an empty body
    When the owner details are opened
    Then the owner details show the previous contact info and an empty pets list
    When the pet type details are opened
    Then the pet type still exists in the directory with its name unchanged
    When the visits log is requested
    Then the visits log shows no trace of the removed visit
