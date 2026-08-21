using NUnit.Framework;

// §10.7 forbids parallel execution: the twenty scenarios share one database, and assertions on
// collection counts would stop being deterministic if two scenarios ran at once.
[assembly: NonParallelizable]
