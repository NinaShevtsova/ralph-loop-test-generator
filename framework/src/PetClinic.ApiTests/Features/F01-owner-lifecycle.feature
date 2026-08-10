@F01
Feature: F-01 Pet owner: registration, data change, deregistration

  The full path of a single owner: registration, appearance in the owners list, change of
  contact details, deregistration. Deregistration is also checked for what it takes with it:
  the owner's pet and that pet's visits must not outlive their owner as records pointing at
  someone who no longer exists.

  @AC-F01-01 @US-01 @US-02 @US-04
  Scenario: AC-F01-01 a registered owner is visible with the submitted values both in the owner details and in the owners list, and the list has no duplicate
    When an owner is registered
    Then the created owner has an assigned id, the submitted values and no pets yet
    When the owner details are opened
    Then the owner details match the registration response
    When the owners list is requested
    Then the owners list contains exactly one entry for the owner with the submitted values

  @AC-F01-02 @US-01 @US-02
  Scenario: AC-F01-02 updated owner contacts are visible in the owner details and the owners list without a duplicate
    Given an owner is registered
    When the owner's contact details are updated
    Then the contact update returns an empty body
    When the owner details are opened
    Then the owner details show the updated contacts with the previous name and address unchanged
    When the owners list is requested
    Then the owners list shows the updated contacts and no entry with the previous ones

  @AC-F01-03 @US-01 @US-03 @US-04
  Scenario: AC-F01-03 a deregistered owner is gone from the owner details and the owners list, and deregistering again gives 404
    Given an owner is registered
    When the owner is deregistered
    Then the deregistration returns an empty body
    When an attempt is made to open the owner details
    Then the owner is reported as not found with an empty body
    When the owners list is requested
    Then the owners list has no entry for the deregistered owner, while other owners remain
    When the owner is deregistered again
    Then the second deregistration reports that no such owner exists

  @AC-F01-04 @US-01 @US-03
  Scenario: AC-F01-04 deregistering an owner removes their pet and that pet's visits
    Given a new pet type is added to the directory
    And an owner is registered
    And a pet is added to the owner
    And a visit is recorded for the pet
    When the owner details are opened
    Then the owner details show the pet and its recorded visit
    When the owner is deregistered
    When an attempt is made to open the owner details
    Then the owner is reported as not found with an empty body
    When an attempt is made to open the pet details
    Then the pet is reported as not found with an empty body
    When an attempt is made to open the visit details
    Then the visit is reported as not found with an empty body
    When the pets list is requested
    And the visits log is requested
    Then the pets list and the visits log show no trace of the removed pet or its visit
