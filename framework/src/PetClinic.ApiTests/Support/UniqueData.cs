using System.Globalization;

namespace PetClinic.ApiTests.Support;

public static class UniqueData
{
    private const string DateFormat = "yyyy-MM-dd";
    private static long _counter;

    public static string LastName(string baseName) => WithSuffix(baseName, maxLength: 30);

    public static string PetName(string baseName) => WithSuffix(baseName, maxLength: 30);

    public static string PetTypeName(string baseName) => WithSuffix(baseName, maxLength: 80);

    public static string VisitDescription(string baseDescription) => WithSuffix(baseDescription, maxLength: 255);

    public static string Telephone()
    {
        var value = NextToken();
        var digits = new char[10];
        for (var i = digits.Length - 1; i >= 0; i--)
        {
            digits[i] = (char)('0' + (int)(value % 10));
            value /= 10;
        }

        return new string(digits);
    }

    public static string Date(DateTime value) => value.ToString(DateFormat, CultureInfo.InvariantCulture);

    private static string WithSuffix(string baseValue, int maxLength)
    {
        var suffix = LettersOnlySuffix();
        var trimmedBase = baseValue.Length + suffix.Length > maxLength
            ? baseValue[..Math.Max(0, maxLength - suffix.Length)]
            : baseValue;

        return trimmedBase + suffix;
    }

    // Digits in a last-name suffix are rejected with 400 (§10.5); base-26 letters keep every
    // caller's suffix safe without each one having to remember the constraint.
    private static string LettersOnlySuffix()
    {
        var value = NextToken();
        var letters = new char[8];
        for (var i = 0; i < letters.Length; i++)
        {
            letters[i] = (char)('A' + (int)(value % 26));
            value /= 26;
        }

        return new string(letters);
    }

    private static ulong NextToken() =>
        (ulong)Interlocked.Increment(ref _counter) ^ (ulong)DateTime.UtcNow.Ticks;
}
