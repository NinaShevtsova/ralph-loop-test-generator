@F00
Feature: F-00 Framework wiring canary

  Not an acceptance criterion and never part of the traceability (design §5.3): this scenario
  exists only to run the hooks, the DI container, ScenarioState, the data provider and the
  request steps end to end at least once in stage 0, before any AC-driven scenario does. Its
  steps are existing request steps only — it adds no step definition of its own.

  @AC-F00-01
  Scenario: AC-F00-01 the pet types directory, an owner and its pet resolve through the full BDD pipeline
    Given the pet types directory is requested
    And an owner is registered
    And a pet is added to the owner
