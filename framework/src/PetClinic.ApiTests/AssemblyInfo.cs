using NUnit.Framework;

// §10.7: the tests of one run share a single database with no transactional isolation, so
// assertions on collection counts would become non-deterministic under parallel execution.
[assembly: NonParallelizable]
