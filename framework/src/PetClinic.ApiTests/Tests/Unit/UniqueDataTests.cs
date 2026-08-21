using System.Globalization;
using FluentAssertions;
using NUnit.Framework;
using PetClinic.ApiTests.Support;

namespace PetClinic.ApiTests.Tests.Unit;

// Proves, by running, every constraint UniqueData centralises: a letters-only last-name suffix
// that never overflows 30 characters (§10.5 — digits give a 400), a telephone of exactly 10
// digits (§11 — 11-20 digits pass schema validation and then fail with a 500), no collisions
// across repeated calls, and a date formatted with InvariantCulture regardless of the running
// thread's culture. No HTTP, no Docker — [Category("Unit")] so the gate can run this before the
// SUT exists.
[TestFixture]
[Category("Unit")]
public sealed class UniqueDataTests
{
    [Test]
    public void LastName_appends_a_letters_only_suffix_and_stays_within_30_characters()
    {
        var lastName = UniqueData.LastName("Testowner");

        lastName.Should().StartWith("Testowner");
        lastName.Length.Should().BeLessThanOrEqualTo(30);
        lastName["Testowner".Length..].Should().MatchRegex("^[a-zA-Z]+$");
    }

    [Test]
    public void LastName_trims_an_over_long_base_instead_of_overflowing()
    {
        var overLongBase = new string('a', 40);

        var lastName = UniqueData.LastName(overLongBase);

        lastName.Length.Should().BeLessThanOrEqualTo(30);
    }

    [Test]
    public void Telephone_is_exactly_10_digits()
    {
        var telephone = UniqueData.Telephone();

        telephone.Should().MatchRegex("^[0-9]{10}$");
    }

    [Test]
    public void PetName_stays_within_30_characters()
    {
        UniqueData.PetName("Leo").Length.Should().BeLessThanOrEqualTo(30);
    }

    [Test]
    public void PetTypeName_stays_within_80_characters()
    {
        UniqueData.PetTypeName("Hamster").Length.Should().BeLessThanOrEqualTo(80);
    }

    [Test]
    public void Repeated_calls_do_not_collide()
    {
        const int calls = 200;

        var lastNames = Enumerable.Range(0, calls).Select(_ => UniqueData.LastName("Testowner")).ToList();
        var telephones = Enumerable.Range(0, calls).Select(_ => UniqueData.Telephone()).ToList();
        var petNames = Enumerable.Range(0, calls).Select(_ => UniqueData.PetName("Leo")).ToList();
        var petTypeNames = Enumerable.Range(0, calls).Select(_ => UniqueData.PetTypeName("Hamster")).ToList();

        lastNames.Distinct().Should().HaveCount(calls);
        telephones.Distinct().Should().HaveCount(calls);
        petNames.Distinct().Should().HaveCount(calls);
        petTypeNames.Distinct().Should().HaveCount(calls);
    }

    [Test]
    public void Date_formats_yyyy_MM_dd_with_invariant_culture_regardless_of_the_current_culture()
    {
        var previousCulture = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("uk-UA");

        try
        {
            UniqueData.Date(new DateTime(2020, 5, 14)).Should().Be("2020-05-14");
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
        }
    }
}
