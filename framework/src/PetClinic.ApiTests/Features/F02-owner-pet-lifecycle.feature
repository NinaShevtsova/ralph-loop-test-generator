@F02
Feature: F-02 Owner's pet: adding, changing, deleting

  A pet can be added only through the owner details, while it can be viewed in three places: inside
  the owner details, in its own pet details, and by opening the pet from the owner details. A pet can
  be changed by two different requests, but deleted only directly. The flow verifies that all these
  places show one and the same record rather than independent copies, and that deleting a pet does
  not affect the owner.
