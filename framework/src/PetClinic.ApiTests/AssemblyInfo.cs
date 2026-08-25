using NUnit.Framework;

// §10.7: the tests share one database with no transactional isolation, so a collection-count
// assertion becomes non-deterministic under parallel execution. The whole assembly runs sequentially.
[assembly: NonParallelizable]
