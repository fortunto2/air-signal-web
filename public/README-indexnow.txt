The file beside this one is an IndexNow key.

IndexNow lets a site tell Bing, Yandex, Seznam and Naver that a URL changed, instead of waiting to
be crawled. Ownership is proved by serving the key at its own filename at the root — that is the
entire protocol, and the key is public by design.

It is a static file rather than a route because it is a constant, and because a route that returned
it would be one more thing that can break between deploys.
