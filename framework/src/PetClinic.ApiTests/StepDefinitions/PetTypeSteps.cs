using System.Net;
using FluentAssertions;
using Reqnroll;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;

namespace PetClinic.ApiTests.StepDefinitions;

// The 4 request steps of the pet type routes (§7). PetType has no update route (glossary: "the
// directory") -- only create, read and delete are wired here.
[Binding]
public sealed class PetTypeSteps
{
    private readonly PetTypesService _petTypes;
    private readonly ScenarioState _state;
    private readonly TestDataProvider _testData;

    public PetTypeSteps(PetTypesService petTypes, ScenarioState state, TestDataProvider testData)
    {
        _petTypes = petTypes;
        _state = state;
        _testData = testData;
    }

    [Given("a new pet type is added to the directory")]
    [When("a new pet type is added to the directory")]
    public async Task ANewPetTypeIsAddedToTheDirectory()
    {
        var testCase = _testData.For<PetTypeCase>();
        var petType = new PetType { Name = UniqueData.PetTypeName(testCase.Name) };

        var response = await _petTypes.Create(petType);
        response.EnsureStatus(HttpStatusCode.Created);
        _state.SetResponse("PetType", response);
        _state.SetEntity("PetType", petType);
        _state.Tracker.TrackPetType(response.Body!.Id!.Value);
    }

    [Given("the pet types directory is requested")]
    [When("the pet types directory is requested")]
    public async Task ThePetTypesDirectoryIsRequested()
    {
        var response = await _petTypes.GetAll();
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("PetTypes", response);
    }

    [When("the pet type details are opened")]
    public async Task ThePetTypeDetailsAreOpened()
    {
        var petTypeId = _state.GetResponse<PetType>("PetType").Body!.Id!.Value;
        var response = await _petTypes.Get(petTypeId);
        response.EnsureStatus(HttpStatusCode.OK);
        _state.SetResponse("PetTypeDetails", response);
    }

    // AC-F02-01, step 1 (flows/F-02-owner-pet-lifecycle.md:100-103): the array-not-empty check is
    // what makes the shared setup convention ("take the first element as the type") a safe read
    // rather than an assumption -- an empty directory would otherwise surface as a null-reference
    // failure deep inside "a pet is added to the owner" instead of here, at its own source.
    [Then("the directory returns at least one pet type")]
    public void TheDirectoryReturnsAtLeastOnePetType()
    {
        var petTypes = _state.GetResponse<List<PetType>>("PetTypes").Body!;

        petTypes.Should().NotBeEmpty(
            because: "GET /pettypes should return at least one pet type for a pet to be created with");
    }

    [When("the pet type is deleted")]
    public async Task ThePetTypeIsDeleted()
    {
        var petTypeId = _state.GetResponse<PetType>("PetType").Body!.Id!.Value;
        var response = await _petTypes.Delete(petTypeId);
        response.EnsureStatus(HttpStatusCode.NoContent);
        _state.SetResponse("PetTypeDelete", response);
    }

    // AC-F02-10, step 5 (flows/F-02-owner-pet-lifecycle.md:365-368): the pet type must still be
    // readable by its own id after the pet using it was deleted, and it must still carry the name it
    // was created with -- proving the directory record itself, not just its existence, survives the
    // pet's deletion (§11: DELETE /pets/{id} preserves the pet type).
    [Then("the pet type still exists in the directory with its name unchanged")]
    public void ThePetTypeStillExistsInTheDirectoryWithItsNameUnchanged()
    {
        var submitted = _state.GetEntity<PetType>("PetType");
        var details = _state.GetResponse<PetType>("PetTypeDetails").Body!;

        details.Name.Should().Be(submitted.Name,
            because: $"pet type id {details.Id}'s name should not change after a pet using it was deleted");
    }
}
