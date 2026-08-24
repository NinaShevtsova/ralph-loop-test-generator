@F01
Feature: F-01 Pet owner: registration, data change, deregistration

  The full path of a single owner: registration, appearance in the owners list, change of contact
  details, deregistration. Deregistration is also checked for what it takes with it: the owner's pet
  and that pet's visits must not outlive their owner as records pointing at someone who no longer
  exists.

  @AC-F01-01 @US-01 @US-02 @US-04
  Scenario: AC-F01-01 a registered owner is visible with the submitted values both in the owner details and in the owners list, and the list has no duplicate
    When an owner is registered
    Then the created owner has an assigned id, the submitted values and an empty pets list
    When the owner details are opened
    Then the owner details show the submitted values and match the registration response
    When the owners directory is requested
    Then the owner appears exactly once in the owners list with the submitted values

  @AC-F01-02 @US-01 @US-02
  Scenario: AC-F01-02 updated owner contacts are visible in the owner details and the owners list without a duplicate
    Given an owner is registered
    When the owner's details are updated
    Then the owner update returns no owner data
    When the owner details are opened
    Then the owner details show the updated contacts and the previous values that were not changed
    When the owners directory is requested
    Then the owner appears exactly once in the owners list with the updated contacts and without the previous ones

  @AC-F01-03 @US-01 @US-03 @US-04
  Scenario: AC-F01-03 a deregistered owner is gone from the owner details and the owners list, and deregistering again gives 404
    Given an owner is registered
    When the owner is deleted
    Then the owner deregistration returns no owner data
    When an attempt is made to open the owner details
    Then the owner details are no longer available
    When the owners directory is requested
    Then the owner is missing from the owners list while other owners remain
    When the owner is deleted again
    Then the repeated deregistration reports that the owner no longer exists
