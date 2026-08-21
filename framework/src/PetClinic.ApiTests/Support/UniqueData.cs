using System.Globalization;
using System.Text;
using System.Threading;

namespace PetClinic.ApiTests.Support;

// Centralises every format constraint the running application enforces on generated test data
// (design §4.1; §10.5 and §11 of the conventions doc), so no caller improvises a value that looks
// reasonable and fails at request time: a digit in a last name is a 400, an 11+ digit telephone
// number passes schema validation and then fails with a 500 on save, and a culture-sensitive date
// format is rejected on a non-invariant machine.
public static class UniqueData
{
    private const int LastNameMaxLength = 30;
    private const int PetNameMaxLength = 30;
    private const int PetTypeNameMaxLength = 80;
    private const int VisitDescriptionMaxLength = 255;
    private const int TelephoneDigits = 10;

    // Seeded from the clock once, then only ever incremented — a single monotonically increasing
    // token per call, so two calls a tick apart still get different values. Combining a counter and
    // a clock with XOR looks equivalent but is not: it destroys the counter's monotonicity and
    // produces real collisions (measured: 11-24 duplicates out of 50 calls). Do not reintroduce XOR
    // here.
    private static long _token = DateTime.UtcNow.Ticks;

    private static ulong NextToken() => (ulong)Interlocked.Increment(ref _token);

    public static string LastName(string baseName) => WithLettersOnlySuffix(baseName, LastNameMaxLength);

    public static string PetName(string baseName) => WithLettersOnlySuffix(baseName, PetNameMaxLength);

    public static string PetTypeName(string baseName) => WithLettersOnlySuffix(baseName, PetTypeNameMaxLength);

    public static string VisitDescription(string baseDescription) =>
        WithLettersOnlySuffix(baseDescription, VisitDescriptionMaxLength);

    // Exactly 10 digits, never 11-20: an 11+ digit telephone number passes schema validation and
    // then fails with a 500 on save (§11).
    public static string Telephone()
    {
        var digits = (NextToken() % 10_000_000_000UL).ToString(CultureInfo.InvariantCulture);
        return digits.PadLeft(TelephoneDigits, '0');
    }

    // "yyyy-MM-dd" regardless of the running thread's culture: a culture-sensitive ToString() on a
    // uk-UA machine produces "14.05.2020" and the server rejects the request.
    public static string Date(DateTime value) => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string WithLettersOnlySuffix(string baseValue, int maxLength)
    {
        var suffix = LettersOnlySuffix(NextToken());
        var maxBaseLength = Math.Max(0, maxLength - suffix.Length);
        var trimmedBase = baseValue.Length > maxBaseLength ? baseValue[..maxBaseLength] : baseValue;
        return trimmedBase + suffix;
    }

    // Base-26 over lowercase letters only — digits in a last name are rejected with a 400 (§10.5).
    private static string LettersOnlySuffix(ulong token)
    {
        var builder = new StringBuilder();
        do
        {
            builder.Insert(0, (char)('a' + (int)(token % 26)));
            token /= 26;
        } while (token > 0);

        return builder.ToString();
    }
}
