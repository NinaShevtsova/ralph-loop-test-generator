using System.Net;
using PetClinic.ApiTests.Http;
using PetClinic.ApiTests.Models;
using PetClinic.ApiTests.Services;
using PetClinic.ApiTests.Support;
using PetClinic.ApiTests.TestData;
using PetClinic.ApiTests.TestData.Cases;
using Reqnroll;

namespace PetClinic.ApiTests.StepDefinitions;

// The 4 request steps of §7 that PetTypesService exposes. §7 lists no Update for PetType, so this
// file has no update step — Create, the two reads, and Delete are the whole surface.
[Binding]
public sealed class PetTypeSteps
{
    private readonly PetTypesService _petTypes;
    private readonly ScenarioState _state;
    private readonly StatusCheck _check;
    private readonly TestDataProvider _data;

    public PetTypeSteps(PetTypesService petTypes, ScenarioState state, StatusCheck check, TestDataProvider data)
    {
        _petTypes = petTypes;
        _state = state;
        _check = check;
        _data = data;
    }

    // One of the four creation sentences that also serves as a Given (S12 DoD): §10.9 requires
    // AC-F01-04 and AC-F02-10 to create their own type rather than borrow a seeded one.
    [Given("a pet type is added to the directory")]
    [When("a pet type is added to the directory")]
    public async Task APetTypeIsAddedToTheDirectory()
    {
        var data = _data.For<PetTypeCase>();
        var petType = new PetType { Name = UniqueData.PetTypeName(data.Name) };

        var response = _check.Expect(await _petTypes.Create(petType), HttpStatusCode.Created);
        var created = response.Body ?? throw new InvalidOperationException("POST /pettypes answered 201 with no body.");

        _state.CreatedPetType = created;
        _state.Set("PetTypeCreateResponse", response);
        _state.Tracker.TrackPetType(created.Id ?? throw new InvalidOperationException("Created pet type carries no id."));
    }

    // Not one of the four creation sentences, but carries [Given] anyway: §10.9's eighteen ACs that
    // reuse a directory type (everyone but AC-F01-04 and AC-F02-10) get it only from this step, and
    // rubric 18 requires every precondition — "an owner is registered with a pet" needs a type before
    // the pet can be added — to live in a Given/And chain. A Given-keyword step only matches a
    // binding carrying [Given], so without this the whole arrange block would be unmatched, i.e. red.
    // §10.9: the ACs that do not need their own type take the first element of this directory, which
    // is why a non-empty result is folded into CreatedPetType here rather than left for the caller to
    // pick out.
    [Given("the pet types directory is requested")]
    [When("the pet types directory is requested")]
    public async Task ThePetTypesDirectoryIsRequested()
    {
        var response = _check.Expect(await _petTypes.GetAll(), HttpStatusCode.OK);
        var directory = response.Body ?? new List<PetType>();

        if (directory.Count > 0)
        {
            _state.CreatedPetType = directory[0];
        }

        _state.Set("PetTypeDirectoryResponse", response);
    }

    [When("the pet type details are opened")]
    public async Task ThePetTypeDetailsAreOpened()
    {
        var petTypeId = _state.CreatedPetType.Id ?? throw new InvalidOperationException("Pet type has no id to open.");
        var response = _check.Expect(await _petTypes.GetById(petTypeId), HttpStatusCode.OK);

        _state.CreatedPetType = response.Body ?? throw new InvalidOperationException("GET /pettypes/{petTypeId} answered 200 with no body.");
        _state.Set("PetTypeGetByIdResponse", response);
    }

    [When("the pet type is deleted")]
    public async Task ThePetTypeIsDeleted()
    {
        var petTypeId = _state.CreatedPetType.Id ?? throw new InvalidOperationException("Pet type has no id to delete.");
        var response = _check.Expect(await _petTypes.Delete(petTypeId), HttpStatusCode.NoContent);
        _state.Set("PetTypeDeleteResponse", response);
    }
}
