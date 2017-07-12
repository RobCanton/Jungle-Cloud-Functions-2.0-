const functions = require('firebase-functions');
const admin = require('firebase-admin');
const request = require('request');
const utilities = require('./utilities.js');
const countryCodes = require('./countryCodes.json');
const anonNames = require('./anonnames.json');
const adjectives = anonNames["adjectives"];
const animals = anonNames["animals"];
const colors = anonNames["colors"];

const GOOGLE_PLACES_API_KEY = "AIzaSyCTo6ejt9CDHW0BpbyhTQ8rcHfgTnDZZ2g";

const WEEK_IN_MILISECONDS = 1000 * 60 * 60 * 24 * 14;

admin.initializeApp(functions.config().firebase);
const express = require('express');
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')();
const cors = require('cors')({
    origin: true
});
const app = express();

const database = admin.database();

// Express middleware that validates Firebase ID Tokens passed in the Authorization HTTP header.
// The Firebase ID token needs to be passed as a Bearer token in the Authorization HTTP header like this:
// `Authorization: Bearer <Firebase ID Token>`.
// when decoded successfully, the ID Token content will be added as `req.user`.
const validateFirebaseIdToken = (req, res, next) => {

    if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) &&
        !req.cookies.__session) {
        console.error('No Firebase ID token was passed as a Bearer token in the Authorization header.',
            'Make sure you authorize your request by providing the following HTTP header:',
            'Authorization: Bearer <Firebase ID Token>',
            'or by passing a "__session" cookie.');
        res.status(403).send('Unauthorized');
        return;
    }

    let idToken;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        // Read the ID Token from the Authorization header.
        idToken = req.headers.authorization.split('Bearer ')[1];
    } else {
        // Read the ID Token from cookie.
        idToken = req.cookies.__session;
    }
    admin.auth().verifyIdToken(idToken).then(decodedIdToken => {
        req.user = decodedIdToken;
        next();
    }).catch(error => {
        console.error('Error while verifying Firebase ID token:', error);
        res.status(403).send('Unauthorized');
    });
};

app.use(bodyParser.json()); // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({ // to support URL-encoded bodies
    extended: true
}));
app.use(cors);
app.use(cookieParser);
app.use(validateFirebaseIdToken);
app.get('/randomAnonymousName', (req, res) => {
    const adjective = randomAdjective();
    const animal = randomAnimal();
    const color = randomColor();
    res.send({
        "adjective": adjective,
        "animal": animal,
        "color": color
    });

});

app.post('/social/blockAnonymousUser', (req, res) => {
    const uid = req.user.uid;
    const body = req.body;
    const aid = req.body.aid;

    console.log("Block user: ", aid);

    const getAuthorRealID = database.ref(`/anon/uid/${aid}`).once('value');

    getAuthorRealID.then(snapshot => {
        if (!snapshot.exists()) {
            return reject();
        }

        const setBlocked = database.ref(`/social/blocked/${uid}/${snapshot.val()}`).set({
            "t": admin.database.ServerValue.TIMESTAMP,
            "anon": true
        });
        return setBlocked;


    }).then(results => {
        console.log("Set!");
        return res.send({
            "success": true,
        });
    }).catch(error => {
        console.log("Something went wrong.");
        res.status(400).send({
            "success": false,
        });
    });


});

app.post('/upload', (req, res) => {

    const uid = req.user.uid;
    const body = req.body;
    const author = req.user.uid;
    const anon = body.anon;
    const color = body.color;
    const type = body.contentType;
    const length = body.length;
    const url = body.url;

    const aid = body.aid;
    const coordinates = body.coordinates;
    const placeID = body.placeID;
    const caption = body.caption;

    var updateObject = {};
    const uploadRef = database.ref(`/uploads/meta/`).push();
    const uploadKey = uploadRef.key;

    var metaObject = {
        "author": author,
        "color": color,
        "contentType": type,
        "length": length,
        "timestamp": admin.database.ServerValue.TIMESTAMP,
        "url": url
    };

    if (placeID) {
        metaObject["placeID"] = placeID;
    }

    if (caption) {
        metaObject["caption"] = caption;
    }

    if (aid) {
        const adjective = randomAdjective();
        const animal = randomAnimal();
        const color = randomColor();

        metaObject["author"] = aid;
        metaObject["anon"] = {

            "adjective": adjective,
            "animal": animal,
            "color": color
        }

        const anonObject = {
            "aid": aid,
            "adjective": adjective,
            "animal": animal,
            "color": color
        }


        updateObject[`uploads/anonNames/${uploadKey}/${uid}`] = anonObject;
        updateObject[`users/storyAnon/${uid}/posts/${uploadKey}`] = admin.database.ServerValue.TIMESTAMP;
        updateObject[`users/uploadsAnon/${uid}/${uploadKey}`] = admin.database.ServerValue.TIMESTAMP;
    } else {
        updateObject[`users/story/${uid}/posts/${uploadKey}`] = admin.database.ServerValue.TIMESTAMP;
        updateObject[`users/uploads/${uid}/${uploadKey}`] = admin.database.ServerValue.TIMESTAMP;
    }

    updateObject[`/uploads/meta/${uploadKey}`] = metaObject;
    updateObject[`/uploads/subscribers/${uploadKey}/${uid}`] = true;

    if (coordinates && coordinates.lat && coordinates.lon) {
        const locationObject = {
            "u": author,
            "lat": coordinates.lat,
            "lon": coordinates.lon,
            "t": admin.database.ServerValue.TIMESTAMP
        }

        updateObject[`/uploads/location/${uploadKey}`] = locationObject;
    }

    if (placeID) {
        const url = `https://maps.googleapis.com/maps/api/place/details/json?placeid=${placeID}&key=${GOOGLE_PLACES_API_KEY}`;
        request(url, function (error, response, body) {

            if (error) {
                return res.status(400).send({
                    "success": false
                });
            } else {

                var jsonResults = JSON.parse(body)["result"];
                const name = jsonResults["name"];
                const addr = jsonResults["formatted_address"];
                const lat = jsonResults["geometry"]["location"]["lat"];
                const lon = jsonResults["geometry"]["location"]["lng"];

                const placeInfo = {
                    "name": name,
                    "address": addr,
                    "lat": lat,
                    "lon": lon
                };

                const placeCoords = {
                    "lat": lat,
                    "lon": lon
                };

                const placeStory = {
                    "t": admin.database.ServerValue.TIMESTAMP,
                    "u": author
                }

                updateObject[`places/info/${placeID}`] = placeInfo;
                updateObject[`places/coords/${placeID}`] = placeCoords;
                updateObject[`places/posts/${placeID}/${uploadKey}`] = admin.database.ServerValue.TIMESTAMP;
                updateObject[`places/story/${placeID}/${uploadKey}`] = placeStory;

            }

            const update = database.ref().update(updateObject);

            update.then(error => {
                if (error) {
                    return res.status(400).send({
                        "success": false
                    });
                } else {
                    res.send({
                        "success": true,
                    });
                }
            });
        });

    } else {
        const update = database.ref().update(updateObject);

        update.then(error => {
            if (error) {
                return res.status(400).send({
                    "success": false
                });
            } else {
                res.send({
                    "success": true,
                });
            }
        });
    }

});


exports.handleNewUser = functions.auth.user().onCreate(event => {
    const user = event.data; // The Firebase user.
    const uid = user.uid;
    console.log("New User: ", user);

    const anonKey = database.ref(`anon/uid/`).push().key;
    const userRef = database.ref(`anon/uid/${anonKey}`).set(uid);
    const anonRef = database.ref(`anon/aid/${uid}`).set(anonKey);

    return Promise.all([userRef, anonRef]).then(results => {
        console.log("User Anon ID generated successfully.");
    });
});

function randomAdjective() {
    return adjectives[Math.floor(Math.random() * adjectives.length)];
}

function randomAnimal() {
    return animals[Math.floor(Math.random() * animals.length)];
}

function randomColor() {
    return colors[Math.floor(Math.random() * colors.length)];
}



exports.handleAnonymousComment = functions.database.ref('/api/requests/anon_comment/{uid}/{postKey}/{requestKey}').onWrite(event => {
    const uid = event.params.uid;
    const postKey = event.params.postKey;
    const requestKey = event.params.requestKey;

    // Only edit data when it is first created.
    if (event.data.previous.exists()) {
        return;
    }
    // Exit when the data is deleted.
    if (!event.data.exists()) {
        return;
    }

    const aid = event.data.val().aid;
    const text = event.data.val().text;
    const timestamp = event.data.val().timestamp;

    console.log("Anon comment recieved.");

    const getExisitingAnonName = database.ref(`/uploads/anonNames/${postKey}/${uid}`).once('value');

    return getExisitingAnonName.then(existingAnonName => {


        if (existingAnonName.exists()) {
            const adjective = existingAnonName.val().adjective;
            const animal = existingAnonName.val().animal;
            const color = existingAnonName.val().color;
            console.log("Anon name already exists");

            const commentObject = {
                "author": aid,
                "text": text,
                "timestamp": timestamp,
                "anon": {
                    "adjective": adjective,
                    "animal": animal,
                    "color": color
                }
            };
            const commentKey = database.ref(`/uploads/comments/${postKey}/`).push().key;
            const setComment = database.ref(`/uploads/comments/${postKey}/${commentKey}`).set(commentObject);
            return setComment.then(results => {});
        }

        const getPostAnonNames = database.ref(`/uploads/anonNames/${postKey}`).once('value');
        return getPostAnonNames.then(snapshot => {

            var adjective = "";
            var animal = "";
            var color = "";
            var validNameFound = false;
            while (!validNameFound) {

                var nameAvailable = true;

                adjective = randomAdjective();
                animal = randomAnimal();
                color = randomColor();

                snapshot.forEach(function (existingAnonName) {
                    const existingAdjective = existingAnonName.val().adjective;
                    const existingAnimal = existingAnonName.val().animal;
                    if (existingAdjective + existingAnimal == adjective + animal) {
                        nameAvailable = false;
                        console.log("Name already Exists!");
                    }
                });

                if (nameAvailable) {
                    validNameFound = true;
                }
            }

            const setAnonName = database.ref(`/uploads/anonNames/${postKey}/${uid}`).set({
                "aid": aid,
                "adjective": adjective,
                "animal": animal,
                "color": color

            });
            const commentObject = {
                "author": aid,
                "text": text,
                "timestamp": timestamp,
                "anon": {
                    "adjective": adjective,
                    "animal": animal,
                    "color": color
                }
            };
            const commentKey = database.ref(`/uploads/comments/${postKey}/`).push().key;
            const setComment = database.ref(`/uploads/comments/${postKey}/${commentKey}`).set(commentObject);

            return Promise.all([setAnonName, setComment]).then(results => {

            });

        });

    });


    return
});

//exports.processUploadLocation = functions.database.ref('/uploads/location/{postKey}').onWrite(event => {
//    const postKey = event.params.postKey;
//
//    // Only edit data when it is first created.
//    if (event.data.previous.exists()) {
//        return;
//    }
//    // Exit when the data is deleted.
//    if (!event.data.exists()) {
//        return;
//    }
//
//    const val = event.data.val();
//    const uid = val.u;
//    const lat = val.lat;
//    const lon = val.lon;
//
//    const reverseGeocode = geocoder.reverse({
//        lat: lat,
//        lon: lon
//    });
//
//    return reverseGeocode.then(function (res) {
//            const body = res[0];
//            const country = body["country"];
//            const countryCode = body["countryCode"];
//
//            const countryObject = countryCodes[countryCode];
//            if (countryObject !== null && countryObject !== undefined) {
//                const badgeID = countryObject["badgeID"];
//                const addBadge = database.ref(`users/badges/${uid}/${badgeID}`).set(true);
//                return addBadge.then(results => {
//
//                });
//            }
//            return
//        })
//        .catch(function (err) {
//            console.log(err);
//        });
//});



exports.removePostData = functions.database.ref('/admin/remove').onWrite(event => {
    const value = event.data.val();

    if (value == null) {
        return
    }

    const r1 = database.ref(`uploads`).remove();
    const r2 = database.ref(`places`).remove();
    const r3 = database.ref(`stories`).remove();
    const r4 = database.ref(`users/story`).remove();
    const r5 = database.ref(`users/feed`).remove();
    const r6 = database.ref(`users/location`).remove();
    const r7 = database.ref(`users/uploads`).remove();
    const r8 = database.ref(`users/viewed`).remove();
    const r9 = database.ref(`users/notifications`).remove();
    const r10 = database.ref(`notifications`).remove();
    return Promise.all([r1, r2, r3, r4, r5, r6, r7, r8, r9, r10]).then(event => {

    });
})


exports.runCleanUp = functions.database.ref('/admin/cleanup').onWrite(event => {
    const value = event.data.val();

    if (value == null) {
        return
    }

    database.ref('/admin/cleanup').remove();

    /*
    const getLivePosts = database.ref(`uploads/live`).once('value');

    return getLivePosts.then(snapshot => {

        var promises = [];

        snapshot.forEach(function (post) {
            const key = post.key;
            const postVal = post.val();
            const timestamp = postVal.timestamp;
            const author = postVal.author;
            const place = postVal.place;

            const age = utilities.getMinutesSinceNow(timestamp);

            if (age >= 1440) {
                const promise = database.ref(`uploads/live/${key}`).remove();
                promises.push(promise);

                const promise2 = database.ref(`uploads/location/${key}`).remove();
                promises.push(promise2);

                const promise3 = database.ref(`uploads/popular/${key}`).remove();
                promises.push(promise3);

                if (author != null) {
                    const promise4 = database.ref(`users/story/${author}/${key}`).remove();
                    promises.push(promise4);
                }

                if (place != null) {
                    const promise5 = database.ref(`places/story/${place}/${key}`).remove();
                    promises.push(promise5);
                }

            }
        });

        return Promise.all(promises).then(results => {

        }).catch(error => {
            console.log("Promise rejected: " + error);
        });
    }) 
    */


    const getMostPopular = database.ref(`uploads/popular`).once('value');
    const getLocationPosts = database.ref(`uploads/location`).once('value');
    const getUserStories = database.ref(`users/story`).once('value');




    return Promise.all([getMostPopular, getLocationPosts, getUserStories]).then(results => {
        const popularSnapshot = results[0];
        const locationsSnapshot = results[1];
        const storiesSnapshot = results[2];

        var promises = [];

        popularSnapshot.forEach(function (_post) {
            const postRef = database.ref(`uploads/stats/${_post.key}`);
            const promise = postRef.transaction(function (post) {
                if (post) {
                    if (post.n !== null && post.n !== undefined) {
                        post.n++;
                    } else {
                        post.n = 0;
                    }
                }
                return post;
            });
            promises.push(promise);
        });

        locationsSnapshot.forEach(function (post) {

            const timestamp = post.val().t;
            const age = utilities.getMinutesSinceNow(timestamp);

            if (age >= 1440 * 3.0) {
                const promise = database.ref(`uploads/location/${post.key}`).remove();
                promises.push(promise);
            }
        });

        storiesSnapshot.forEach(function (storySnapshot) {
            const uid = storySnapshot.key;
            const story = storySnapshot.val();
            const posts = story.posts;

            Object.keys(posts).forEach(key => {
                const timestamp = posts[key];
                const age = utilities.getMinutesSinceNow(timestamp);

                if (age >= 1440) {
                    const promise = database.ref(`users/story/${uid}/posts/${key}`).remove();
                    promises.push(promise);
                }
            });

        });

        return Promise.all(promises).then(results => {

        }).catch(function (error) {
            console.log("Promise rejected: " + error);
        });

    });


});

function clearViews(postKey) {
    const getViews = database.ref(`uploads/views/${postKey}`);

    return getViews.then(snapshot => {
        snapshot.forEach(function (uid) {
            database.ref(`users/viewed/${uid}/${postKey}`).remove();
        });

    });
}

/**
 * Triggers when a user gets a new follower and sends a notification.
 *
 * Followers add a flag to `/followers/{followedUid}/{followerUid}`.
 * Users save their device notification tokens to `/users/{followedUid}/notificationTokens/{notificationToken}`.
 */


exports.sendFollowerNotification = functions.database.ref('/social/following/{followerUid}/{followedUid}').onWrite(event => {
    const followerUid = event.params.followerUid;
    const followedUid = event.params.followedUid;
    const value = event.data.val();

    updateFollowerCounts(followerUid, followedUid);

    if (value == null) {
        return database.ref(`/social/followers/${followedUid}/${followerUid}`).remove();
    }

    let notificationObject = {};

    // Custom key pattern so that all follow notifications are user -> user specific
    let nKey = `follow:${followedUid}:${followerUid}`;

    notificationObject[`notifications/${nKey}`] = {
        "type": 'FOLLOW',
        "sender": followerUid,
        "recipient": followedUid,
        "timestamp": admin.database.ServerValue.TIMESTAMP
    }
    notificationObject[`users/notifications/${followedUid}/${nKey}`] = {
        "seen": false,
        "timestamp": admin.database.ServerValue.TIMESTAMP
    };

    const promises = [
        database.ref().update(notificationObject),
        database.ref(`/social/blocked/${followerUid}/${followedUid}`).remove(),
        database.ref(`/social/blocked_by/${followedUid}/${followerUid}`).remove(),
        database.ref(`/social/followers/${followedUid}/${followerUid}`).set(false)
    ];

    return Promise.all(promises).then(results => {
        const setNotificationResult = results[0];
    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });

});


function updateFollowerCounts(followerUid, followedUid) {

    const follower_count = database.ref(`social/following/${followerUid}`).once('value');
    const followed_count = database.ref(`social/followers/${followedUid}`).once('value');

    return Promise.all([follower_count, followed_count]).then(results => {
        const following = results[0];
        const followers = results[1];

        const setFollowingCount = database.ref(`users/profile/${followerUid}/following`).set(following.numChildren());
        const setFollowersCount = database.ref(`users/profile/${followedUid}/followers`).set(followers.numChildren());

        return Promise.all([setFollowingCount, setFollowersCount]).then(results => {

        });
    });
}

exports.processUserBlocked = functions.database.ref('/social/blocked/{uid}/{blocked_uid}').onWrite(event => {
    const uid = event.params.uid;
    const blocked_uid = event.params.blocked_uid;
    const value = event.data.val();

    if (value == null) {
        const conv_ref_1 = database.ref(`users/conversations/${blocked_uid}/${uid}/blocked`).remove();
        const conv_ref_2 = database.ref(`users/conversations/${uid}/${blocked_uid}/blocked`).remove();
        return Promise.all([conv_ref_1, conv_ref_2]).then(results => {

        });
    }


    const follow_ref_1 = database.ref(`social/followers/${uid}/${blocked_uid}`).remove();
    const follow_ref_2 = database.ref(`social/following/${uid}/${blocked_uid}`).remove();
    const follow_ref_3 = database.ref(`social/followers/${blocked_uid}/${uid}`).remove();
    const follow_ref_4 = database.ref(`social/following/${blocked_uid}/${uid}`).remove();
    const conv_ref_1 = database.ref(`users/conversations/${blocked_uid}/${uid}/blocked`).set(true);
    const conv_ref_2 = database.ref(`users/conversations/${uid}/${blocked_uid}/blocked`).set(true);

    return Promise.all([follow_ref_1, follow_ref_2, follow_ref_3, follow_ref_4, conv_ref_1, conv_ref_2]).then(results => {
        console.log("Follow social removed");

    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });
});

exports.handleBlockedUser = functions.database.ref('/social/blockedUsers/{uid}/{blocked_uid}').onWrite(event => {
    const uid = event.params.uid;
    const blocked_uid = event.params.blocked_uid;

    // Exit when the data is deleted.
    if (!event.data.exists()) {
        const getAnonID = database.ref(`anon/aid/${blocked_uid}`).once('value');
        
        return getAnonID.then(snapshot => {
            const aid = snapshot.val();
            
            const getBlockedAnonEntry = database.ref(`/social/blockedAnonymous/${uid}/${aid}`).once('value');
            
            return getBlockedAnonEntry.then(snapshot => {
                if (snapshot.exists()) {
                    return
                }

                const removeBlocked = database.ref(`/social/blocked/${uid}/${blocked_uid}`).remove();
                return removeBlocked;
            });
        });
    }

    const setBlocked = database.ref(`/social/blocked/${uid}/${blocked_uid}`).set(true);
    return setBlocked;

});

exports.handleBlockedAnonymousUser = functions.database.ref('/social/blockedAnonymous/{uid}/{blocked_aid}').onWrite(event => {
    const uid = event.params.uid;
    const blocked_aid = event.params.blocked_aid;

    const getBlockedRealID = database.ref(`anon/uid/${blocked_aid}`).once('value');
    return getBlockedRealID.then(snapshot => {
        const blocked_uid = snapshot.val();

        // Exit when the data is deleted.
        if (!event.data.exists()) {
            const getBlockedUserEntry = database.ref(`/social/blockedUsers/${uid}/${blocked_uid}`).once('value');

            return getBlockedUserEntry.then(snapshot => {
                if (snapshot.exists()) {
                    return
                }

                const removeBlocked = database.ref(`/social/blocked/${uid}/${blocked_uid}`).remove();
                return removeBlocked;

            });

        }

        const setBlocked = database.ref(`/social/blocked/${uid}/${blocked_uid}`).set(true);
        return setBlocked;

    });
});


/*  Process Uploads
    - If new post, add to follower feeds
    - If removed post, remove from follower follower feeds
*/

exports.processUploads =
    functions.database.ref('/uploads/meta/{uploadKey}').onWrite(event => {
        const uploadKey = event.params.uploadKey;
        const value = event.data.val();
        const newData = event.data._newData;
        const prevData = event.data.previous._data;

        if (value == null || value == undefined) {
            return deletePost(uploadKey, prevData.author, prevData.placeID);
        }

        if (prevData !== null) {
            return;
        }

        const author = newData.author;
        const timestamp = newData.timestamp;
        const place = newData.placeID;

        var promises = [];
        return;
        //        const followersRef = database.ref(`social/followers/${author}`).once('value');
        //        promises.push(followersRef);
        //
        //
        //        const statUpdate = database.ref(`uploads/stats/${uploadKey}/t`).set(timestamp);
        //        promises.push(statUpdate);
        //
        //        return Promise.all([promises]).then(results => {
        //            let snapshot = results[0];
        //
        //            if (snapshot.exists()) {
        //
        //                snapshot.forEach(function (follower) {
        //                    const followerUid = follower.key;
        //
        //                    const tempRef = database.ref(`social/stories/${followerUid}/${author}/${uploadKey}`);
        //                    tempRef.set(dateCreated);
        //
        //                });
        //            }
        //        });
    });

function deletePost(key, author, placeId) {
    console.log("Delete post: ", key);

    var promises = [
        database.ref(`uploads/notifications/${key}`).once('value'),
        database.ref(`users/uploads/${author}/${key}`).remove(),
        database.ref(`uploads/comments/${key}`).remove(),
        database.ref(`users/story/${author}/posts/${key}`).remove(),
        database.ref(`uploads/location/${key}`).remove(),
        database.ref(`uploads/live/${key}`).remove(),
        database.ref(`uploads/likes/${key}`).remove(),
        database.ref(`uploads/popular/${key}`).remove(),
        database.ref(`uploads/stats/${key}`).remove(),
        database.ref(`uploads/subscribers/${key}`).remove(),
        database.ref(`reports/posts/${key}`).remove()
    ];

    if (placeId !== null && placeId !== undefined) {
        const removePlacePost = database.ref(`places/posts/${placeId}/${key}`).remove();
        const removePlaceStory = database.ref(`places/story/${placeId}/${key}`).remove();

        promises.push(removePlacePost);
        promises.push(removePlaceStory);
    }

    return Promise.all(promises).then(results => {
        const notifications = results[0];
        var removeNotificationPromises = [];
        notifications.forEach(function (notificationPair) {
            const notificationKey = notificationPair.key;
            const promise = database.ref(`notifications/${notificationKey}`).remove();
            removeNotificationPromises.push(promise);
        });

        return Promise.all(removeNotificationPromises).then(snapshot => {

        }).catch(function (error) {
            console.log("Promise rejected: " + error);
        });

    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });
}

exports.processNotifications = functions.database.ref('/notifications/{notificationKey}').onWrite(event => {
    const notificationKey = event.params.notificationKey;
    const value = event.data.val();
    const prevData = event.data.previous._data;
    const newData = event.data._newData;

    if (value == null && prevData !== null) {
        const recipient = prevData.recipient;
        const postKey = prevData.postKey;
        var promises = [
            database.ref(`users/notifications/${recipient}/${notificationKey}`).remove()
        ];

        if (postKey !== null && postKey !== undefined) {
            const removeUploadNotification = database.ref(`uploads/notifications/${postKey}/${notificationKey}`).remove();
            promises.push(removeUploadNotification);
        }
        return Promise.all(promises).then(result => {});
    }

    const type = newData.type;
    const sender = newData.sender;
    const recipient = newData.recipient;
    const text = newData.text;

    const postKey = newData.postKey;

    const obj = {
        "seen": false,
        "timestamp": admin.database.ServerValue.TIMESTAMP
    };
    database.ref(`users/notifications/${recipient}/${notificationKey}`).set(obj);

    if (postKey !== null && postKey !== undefined) {
        database.ref(`uploads/notifications/${postKey}/${notificationKey}`).set(true);
    }

    const getRecipientSettings = database.ref(`/users/settings/${recipient}/push_notifications`).once('value');
    return getRecipientSettings.then(snapshot => {

        if (snapshot.exists() && !snapshot.val()) {
            return
        }

        const getSenderUsername = database.ref(`/users/profile/${sender}/username`).once('value');
        const getRecipientToken = database.ref(`/users/FCMToken`).orderByValue().equalTo(recipient).once('value');
        const getUnseenNotifications = database.ref(`/users/notifications/${recipient}`).orderByChild('seen').equalTo(false).once('value');
        const getUnseenMessages = database.ref(`/users/conversations/${recipient}`).orderByChild('seen').equalTo(false).once('value');

        return Promise.all([getSenderUsername, getRecipientToken, getUnseenNotifications, getUnseenMessages]).then(results => {

            const usernameSnapshot = results[0];
            const recipientTokens = results[1];
            const numUnseenNotifications = results[2].numChildren();
            const numUnseenMessages = results[3].numChildren();

            console.log("numUnseenNotifications: ", numUnseenNotifications);
            console.log("numUnseenMessages: ", numUnseenMessages);

            var username = "Someone";

            if (usernameSnapshot.exists() && usernameSnapshot.val() !== "") {
                username = usernameSnapshot.val();
            }

            var body = "";

            switch (type) {
            case "FOLLOW":
                body = `${username} started following you.`;
                break;
            case "MENTION":
                body = `${username} mentioned you in a comment: "${text}"`;
                break;
            case "COMMENT":
                body = `${username} commented on your post: "${text}"`;
                break;
            case "COMMENT_ALSO":
                body = `${username} also commented: "${text}"`;
                break;
            case "COMMENT_TO_SUB":
                body = `${username} commented on a post you are following: "${text}"`;
                break;
            case "LIKE":
                body = `${username} liked your post.`;
                break;
            case "BADGE":
                body = `You've unlocked a new badge!`
                break
            default:
                break;
            }

            var pushNotificationPayload = {
                "notification": {
                    "body": body,
                    "badge": `${numUnseenNotifications + numUnseenMessages}`
                }
            };

            console.log("Send payload: ", pushNotificationPayload);

            var promises = [];

            if (body === "") {
                return
            };

            recipientTokens.forEach(function (token) {
                const sendPushNotification = admin.messaging().sendToDevice(token.key, pushNotificationPayload);
                promises.push(sendPushNotification);
            });

            return Promise.all(promises).then(pushResult => {
                console.log("Push notification sent.");
            }).catch(function (error) {
                console.log("Promise rejected: " + error);
            });
        }).catch(function (error) {
            console.log("Promise rejected: " + error);
        });
    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });
});

exports.sendCommentNotification = functions.database.ref('/uploads/comments/{postKey}/{commentKey}').onWrite(event => {
    const postKey = event.params.postKey;
    const commentKey = event.params.commentKey;
    const value = event.data.val();
    const newData = event.data._newData;

    if (value == null || newData == null) {
        const postCommentsPromise = database.ref(`/uploads/comments/${postKey}`).once('value');

        return postCommentsPromise.then(results => {

            var numComments = 0;
            if (results.exists()) {
                numComments = results.numChildren();
            }

            if (numComments > 0) {
                return database.ref(`/uploads/meta/${postKey}/comments`).set(numComments);
            } else {
                return database.ref(`/uploads/meta/${postKey}/comments`).remove();
            }

        }).catch(function (error) {
            console.log("Promise rejected: " + error);
        });
    }

    const sender = newData.author;
    const anonData = newData.anon;
    console.log("ANON DATA: ", anonData);
    const postAuthorPromise = database.ref(`uploads/meta/${postKey}`).once('value');
    const postCommentsPromise = database.ref(`/uploads/comments/${postKey}`).once('value');
    const postSubscribersPromise = database.ref(`/uploads/subscribers/${postKey}`).once('value');
    const postAnonNames = database.ref(`/uploads/anonNames/${postKey}`).once('value');
    var promises = [
        postAuthorPromise,
        postCommentsPromise,
        postSubscribersPromise,
        postAnonNames
    ];

    var mentions = utilities.extractMentions(newData.text);

    for (var i = 0; i < mentions.length; i++) {
        mentions[i] = mentions[i].substring(1);
        const username = mentions[i];
        const lookupPromise = database.ref(`users/lookup/username`).orderByValue().equalTo(username).limitToFirst(1).once("value");
        promises.push(lookupPromise);
    }

    return Promise.all(promises).then(results => {
        const postMeta = results[0].val();
        const commentsResults = results[1];
        const subscribersResults = results[2];
        const anonNames = results[3];

        const postAuthor = postMeta.author;
        const placeId = postMeta.placeID;

        var mentioned_uids = [];
        var senderRealUid = "";

        var anonNamesDict = {};
        anonNames.forEach(function (anonName) {
            const name = anonName.val().adjective + anonName.val().animal;
            if (sender == anonName.val().aid) {
                senderRealUid = anonName.key;
            }
            anonNamesDict[name.toLowerCase()] = anonName.key;
        });

        for (var m = 0; m < mentions.length; m++) {
            const mention = mentions[m];
            const result = results[m + 4].val();

            const anonEntry = anonNamesDict[mention.toLowerCase()];

            if (anonEntry !== null && anonEntry !== undefined) {
                console.log("ENTRY: ", anonEntry);
                mentioned_uids.push(anonEntry);
            } else if (result !== null) {
                const uid = Object.keys(result)[0];
                mentioned_uids.push(uid);
            }

        }

        /* Update post meta with number of comments */
        var numComments = 0;
        var commenters = [];
        var participants = {};
        if (commentsResults.exists()) {

            numComments = commentsResults.numChildren()
            var array = [];
            commentsResults.forEach(function (comment) {
                array.push(comment.val().author);
                participants[comment.val().author] = true;
            });

            commenters = array.unique();
            console.log("Commenters: ", commenters);
        }

        var metaUpdateObject = {};
        metaUpdateObject[`/uploads/meta/${postKey}/comments`] = numComments;
        metaUpdateObject[`/uploads/meta/${postKey}/commenters`] = commenters.length;

        const metaUpdatePromise = database.ref().update(metaUpdateObject);

        /* Write comment notifications to post author and mentioned users  */
        var notificationObject = {};

        const trimmedString = utilities.trimTextForNotification(newData.text);
        if (trimmedString !== null) {

            for (var j = 0; j < mentioned_uids.length; j++) {
                const mentioned_uid = mentioned_uids[j];
                if (mentioned_uid !== sender) {
                    let nKey = `mention:${postKey}:${mentioned_uid}`

                    var noteObject = {
                        "type": 'MENTION',
                        "postKey": postKey,
                        "sender": sender,
                        "recipient": mentioned_uid,
                        "text": trimmedString,
                        "timestamp": admin.database.ServerValue.TIMESTAMP
                    }

                    if (anonData !== null && anonData !== undefined) {
                        noteObject["anon"] = anonData;
                    }

                    notificationObject[`notifications/${nKey}`] = noteObject;

                }
            }

            subscribersResults.forEach(function (subscriber) {

                let subscriber_uid = subscriber.key;
                console.log(`Sub: ${subscriber_uid} | Sender: ${sender}`);
                if (subscriber_uid !== sender && subscriber_uid !== senderRealUid && mentioned_uids.containsAtIndex(subscriber_uid) === null) {
                    console.log("SEND NOTIFICATION TO: ", subscriber_uid);
                    let nKey = `comment:${postKey}:${subscriber_uid}`

                    var type = 'COMMENT';
                    var count = count = commenters.length;
                    const i = commenters.containsAtIndex(subscriber_uid);
                    if (i !== null) {
                        count -= 1;
                    }

                    if (subscriber_uid !== postAuthor) {
                        if (i !== null) {
                            type = 'COMMENT_ALSO';
                            count = commenters.slice(i + 1).length;
                        } else {
                            type = 'COMMENT_TO_SUB';
                        }
                    }
                    var noteObject = {
                        "type": type,
                        "postKey": postKey,
                        "sender": sender,
                        "recipient": subscriber_uid,
                        "text": trimmedString,
                        "count": count,
                        "timestamp": admin.database.ServerValue.TIMESTAMP
                    }

                    if (anonData !== null && anonData !== undefined) {
                        noteObject["anon"] = anonData;
                    }

                    notificationObject[`notifications/${nKey}`] = noteObject;

                }
            });

        }

        const notificationPromise = database.ref().update(notificationObject);

        return Promise.all([metaUpdatePromise, notificationPromise]).then(results => {

        }).catch(function (error) {
            console.log("Promise rejected: " + error);
        });
    });


});

exports.updateLikesMeta = functions.database.ref('/uploads/likes/{postKey}/{uid}').onWrite(event => {
    const userId = event.params.uid;
    const postKey = event.params.postKey;
    const value = event.data.val();
    const newData = event.data._newData;

    const postDataPromise = database.ref(`/uploads/meta/${postKey}`).once('value');
    const postLikesPromise = database.ref(`/uploads/likes/${postKey}`).once('value');

    return Promise.all([postDataPromise, postLikesPromise]).then(results => {
        const postMeta = results[0].val();
        const postLikes = results[1];
        const author = postMeta.author;
        const live = postMeta.live;
        const placeId = postMeta.placeID;

        const numLikes = postLikes.numChildren();
        var promises = [];

        if (numLikes > 0) {
            const promise = database.ref(`/uploads/meta/${postKey}/likes`).set(numLikes);
            promises.push(promise);
            var notificationObject = {};
            const nKey = `like:${postKey}`;
            const nObject = {
                "type": 'LIKE',
                "postKey": postKey,
                "sender": userId,
                "recipient": author,
                "count": numLikes,
                "timestamp": admin.database.ServerValue.TIMESTAMP
            }

            const notificationPromise = database.ref(`notifications/${nKey}`).set(nObject);
            promises.push(notificationPromise);

        } else {
            const promise = database.ref(`/uploads/meta/${postKey}/likes`).remove();
            promises.push(promise);

            const nKey = `like:${postKey}`;
            const removeNotification = database.ref(`notifications/${nKey}`).remove();
            promises.push(removeNotification);
        }

        const promise = database.ref(`/uploads/stats/${postKey}/l`).set(numLikes);
        promises.push(promise);


        return Promise.all(promises).then(result => {

        }).catch(function (error) {
            console.log("Promise rejected: " + error);
        });
    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });
});

exports.updateViewsMeta = functions.database.ref('/uploads/views/{postKey}/{uid}').onWrite(event => {
    const userId = event.params.uid;
    const postKey = event.params.postKey;
    const value = event.data.val();
    const newData = event.data._newData;
    var toRemove = false;
    if (value == null) {
        toRemove = true;
    }

    const postDataPromise = database.ref(`/uploads/meta/${postKey}`).once('value');
    const postViewsPromise = database.ref(`/uploads/views/${postKey}`).once('value');

    return Promise.all([postDataPromise, postViewsPromise]).then(results => {
        const postMeta = results[0].val();
        const postViews = results[1];
        const author = postMeta.author;
        const live = postMeta.live;
        const placeId = postMeta.placeID;

        const numViews = postViews.numChildren();

        var promises = [];

        if (numViews > 0) {
            const promise = database.ref(`/uploads/meta/${postKey}/views`).set(numViews);
            promises.push(promise);
        } else {
            const promise = database.ref(`/uploads/meta/${postKey}/views`).remove();
            promises.push(promise);
        }

        if (live && postViews.val() !== null && postViews.val() !== undefined) {
            const promise = database.ref(`/uploads/stats/${postKey}/v`).set(numViews);
            promises.push(promise);
        }

        return Promise.all(promises).then(result => {

        }).catch(function (error) {
            console.log("Promise rejected: " + error);
        });
    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });
});

exports.updateReportsMeta = functions.database.ref('/reports/posts/{postKey}').onWrite(event => {
    const userId = event.params.uid;
    const postKey = event.params.postKey;

    const numReports = event.data.numChildren()
    var promises = [];
    if (numReports > 0) {
        const promise = database.ref(`/uploads/meta/${postKey}/reports`).set(numReports);
        promises.push(promise);
    } else {
        const promise = database.ref(`/uploads/meta/${postKey}/reports`).remove();
        promises.push(promise);
    }

    return Promise.all(promises).then(result => {

    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });

});

exports.locationUpdate = functions.database.ref('/users/location/coordinates/{uid}').onWrite(event => {
    const userId = event.params.uid;
    const value = event.data.val();
    const newData = event.data._newData;

    if (value == null || newData == null) {
        return console.log('Location removed: ', userId);
    }

    const lat = newData.lat;
    const lon = newData.lon;
    const rad = newData.rad;

    const userCoordsRef = database.ref('uploads/location/').once('value');
    const placeCoordsRef = database.ref('places/coords/').once('value');

    return Promise.all([userCoordsRef, placeCoordsRef]).then(results => {
        const userCoordsSnap = results[0];
        const placeCoordsSnap = results[1];

        var nearbyPosts = {};

        userCoordsSnap.forEach(function (post) {
            const postKey = post.key;
            const post_lat = post.val().lat;
            const post_lon = post.val().lon;
            const post_time = post.val().t;

            const distance = utilities.haversineDistance(lat, lon, post_lat, post_lon);
            if (distance <= rad) {
                nearbyPosts[postKey] = {
                    "d": distance,
                    "t": post_time
                }
            }
        });

        const setNearbyPosts = database.ref(`users/location/nearby/${userId}/posts`).set(nearbyPosts);

        var nearbyPlaces = {};

        placeCoordsSnap.forEach(function (place) {
            const placeKey = place.key;
            const place_lat = place.val().lat;
            const place_lon = place.val().lon;
            const distance = utilities.haversineDistance(lat, lon, place_lat, place_lon);
            if (distance <= rad) {
                nearbyPlaces[placeKey] = distance;
            }
        });

        const setNearbyPlaces = database.ref(`users/location/nearby/${userId}/places`).set(nearbyPlaces);

        return Promise.all([setNearbyPosts, setNearbyPlaces]).then(result => {



        });

    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });
});

exports.conversationMetaUpdate = functions.database.ref('/conversations/{conversationKey}/meta').onWrite(event => {
    const conversationKey = event.params.conversationKey;
    const value = event.data.val();
    const prevData = event.data.previous._data;
    const newData = event.data._newData;

    const uids = conversationKey.split(":");
    const uidA = uids[0];
    const uidB = uids[1];


    var lastSeenA = newData[uidA];
    const lastSeenB = newData[uidB];
    const lastMessage = newData.latest;
    const sender = newData.sender;
    const text = newData.text;
    const isMediaMessage = newData.isMediaMsg;

    var recipient = uidA;
    if (recipient == sender) {
        recipient = uidB;
    }

    console.log(`lastSeenA: ${lastSeenA} lastSeenB: ${lastSeenB} lastest: ${lastMessage} text: ${text}`);

    var updateObject = {};

    if (lastSeenA == null || lastSeenA == undefined) {
        return database.ref(`/conversations/${conversationKey}/meta/${uidA}`).set(0).then(result => {});
    }

    if (lastSeenB == null || lastSeenB == undefined) {
        return database.ref(`/conversations/${conversationKey}/meta/${uidB}`).set(0).then(result => {});
    }

    updateObject[`users/conversations/${uidA}/${uidB}/seen`] = lastSeenA >= lastMessage;
    updateObject[`users/conversations/${uidA}/${uidB}/latest`] = lastMessage;
    updateObject[`users/conversations/${uidA}/${uidB}/sender`] = sender;
    updateObject[`users/conversations/${uidA}/${uidB}/isMediaMessage`] = isMediaMessage;

    updateObject[`users/conversations/${uidB}/${uidA}/seen`] = lastSeenB >= lastMessage;
    updateObject[`users/conversations/${uidB}/${uidA}/latest`] = lastMessage;
    updateObject[`users/conversations/${uidB}/${uidA}/sender`] = sender;
    updateObject[`users/conversations/${uidB}/${uidA}/isMediaMessage`] = isMediaMessage;

    if (text !== null && text !== undefined) {
        updateObject[`users/conversations/${uidA}/${uidB}/text`] = text;
        updateObject[`users/conversations/${uidB}/${uidA}/text`] = text;
    }

    const update = database.ref().update(updateObject);
    const notificationsEnabled = database.ref(`/users/settings/${recipient}/push_notifications`).once('value');

    return Promise.all([update, notificationsEnabled]).then(results => {
        const settings = results[1];

        if (settings.exists() && !settings.val()) {
            return
        }

        if (recipient == uidA && lastSeenA > lastMessage) {
            return console.log("Recipient A has already seen.")
        } else if (recipient == uidB && lastSeenB > lastMessage) {
            return console.log("Recipient B has already seen.")
        }

        const getSenderUsername = database.ref(`/users/profile/${sender}/username`).once('value');
        const getRecipientToken = database.ref(`/users/FCMToken`).orderByValue().equalTo(recipient).once('value');
        const getUnseenNotifications = database.ref(`/users/notifications/${recipient}`).orderByChild('seen').equalTo(false).once('value');
        const getUnseenMessages = database.ref(`/users/conversations/${recipient}`).orderByChild('seen').equalTo(false).once('value');

        return Promise.all([getSenderUsername, getRecipientToken, getUnseenNotifications, getUnseenMessages]).then(results2 => {
            const username = results2[0].val();
            const recipientTokens = results2[1];

            const numUnseenNotifications = results2[2].numChildren();
            const numUnseenMessages = results2[3].numChildren();

            const pushNotificationPayload = {
                "notification": {
                    "body": `${username}: ${text}`,
                    "badge": `${numUnseenNotifications + numUnseenMessages}`
                }
            };

            var promises = [];

            recipientTokens.forEach(function (token) {
                const sendPushNotification = admin.messaging().sendToDevice(token.key, pushNotificationPayload);
                promises.push(sendPushNotification);
            });


            console.log("PAYLOAD: ", pushNotificationPayload);
            console.log("TOKEN(S): ", recipientTokens.val());

            return Promise.all(promises).then(pushResult => {
                console.log("Push notification sent.");
            }).catch(function (error) {
                console.log("Promise rejected: " + error);
            });
        });

    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });
});

exports.sendMessageNotification = functions.database.ref('/conversations/{conversationKey}/messages/{messageKey}').onWrite(event => {
    const conversationKey = event.params.conversationKey;
    const messageKey = event.params.messageKey;
    const newData = event.data._newData;
    console.log("Message: ", messageKey, " -> Conversation: ", conversationKey);

    const sender = newData.senderId;
    const text = newData.text;
    const uploadKey = newData.uploadKey;
    const timestamp = newData.timestamp;
    if (newData == null || timestamp == null) {
        return
    }

    const uids = conversationKey.split(":");
    const uidA = uids[0];
    const uidB = uids[1];

    var metaObject = {}
    metaObject[sender] = timestamp;
    metaObject["text"] = "";
    metaObject["latest"] = timestamp;
    metaObject["sender"] = sender;
    metaObject["A"] = uidA;
    metaObject["B"] = uidB;
    metaObject["isMediaMsg"] = uploadKey !== null && uploadKey !== undefined;

    if (text !== null && text !== undefined) {
        metaObject["text"] = text;
    }

    const updateMeta = event.data.adminRef.parent.parent.child("meta").update(metaObject);

    return updateMeta.then(results => {

    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });

});

exports.updateUserUploadCount = functions.database.ref('/users/uploads/{uid}/{postKey}').onWrite(event => {
    const uid = event.params.uid;
    const value = event.data.value;

    return database.ref(`users/uploads/${uid}`).once('value').then(snapshot => {

        return database.ref(`users/profile/${uid}/posts`).set(snapshot.numChildren());
    });
});


exports.updatePostMeta = functions.database.ref('/uploads/stats/{postKey}').onWrite(event => {
    const postKey = event.params.postKey;

    const value = event.data.val();

    if (value == null || value == undefined) {
        return
    }
    const t = value.t;

    if (t == undefined || t == null) {
        return
    }
    const comments = value.c;

    const now = Date.now();
    const timeSinceNow = (now - t) / WEEK_IN_MILISECONDS;

    const timeRatio = 1 - timeSinceNow;

    //    console.log("TimeNow: ", now);
    //    console.log("TimeSinceNow: ", timeSinceNow);
    //    console.log("TimeRatio: ", timeRatio);

    var views = 0;
    if (value.v != null && value.v != undefined) {
        views = value.v;
    }

    var likes = 0;
    if (value.l != null && value.l != undefined) {
        likes = value.l;
    }

    var participants = 0;
    if (value.p != null && value.p != undefined) {
        participants = Object.keys(value.p).length;
    }

    //    console.log("p: ", participants);
    //    console.log("l: ", likes);
    //    console.log("v: ", views);
    //    console.log("t: ", timeRatio);

    const pop = ((participants * 3.0 + likes * 2.0)) * timeRatio;


    //    console.log("POPULARITY: ", pop);

    var promises = [];

    if (pop > 2) {
        const setPopularity = database.ref(`/uploads/popular/${postKey}`).set(pop);
        promises.push(setPopularity);
    } else {
        const removePopularity = database.ref(`/uploads/popular/${postKey}`).remove();
        promises.push(removePopularity);
    }

    const setMetaPopularity = database.ref(`/uploads/meta/${postKey}/popularity`).set(pop);
    promises.push(setMetaPopularity);

    return Promise.all(promises).then(snapshot => {

    });
});

exports.updateUsername = functions.database.ref('/users/profile/{uid}/username').onWrite(event => {
    const uid = event.params.uid;
    const value = event.data.val();


    if (value != null && value != undefined) {
        const addUsernameLookupEntry = database.ref(`/users/lookup/username/${uid}`).set(value);
        return addUsernameLookupEntry.then(snapshot => {

        });

    } else {
        return
    }

});

exports.sendNewBadgeNotification = functions.database.ref('/users/badges/{uid}/{badgeID}').onWrite(event => {
    const uid = event.params.uid;
    const badgeID = event.params.badgeID;
    const value = event.data.val();

    if (value == null || value == undefined) {
        return
    }


    let nKey = `badge:${uid}:${badgeID}`

    var type = 'BADGE';

    var object = {
        "type": type,
        "sender": uid,
        "recipient": uid,
        "text": badgeID,
        "timestamp": admin.database.ServerValue.TIMESTAMP
    };

    return database.ref(`/notifications/badge:${uid}:${badgeID}`).set(object);

});

exports.handleSearchRequest = functions.database.ref('/api/requests/user_search/{uid}').onWrite(event => {
    const uid = event.params.uid;
    const searchText = event.data.val();

    const usersIds = {};

    const getUsersnames = database.ref(`/users/lookup/username`).once("value");

    return getUsersnames.then(snapshot => {

        var results = {};

        if (searchText === null || searchText === "") {
            const setResponse = database.ref(`/api/responses/user_search/${uid}`).remove();
            return setResponse.then(results => {

            });
        }

        snapshot.forEach(function (entry) {
            const username = entry.val();
            let length = searchText.length;
            if (length < 5) {
                let subName = username.substring(0, length);
                if (searchText == subName) {
                    results[entry.key] = username;
                }
            } else {
                if (username.includes(searchText)) {
                    results[entry.key] = username;
                }
            }
        });

        const setResponse = database.ref(`/api/responses/user_search/${uid}`).set(results);
        return setResponse.then(results => {

        });
    });
})

exports.addAnonynmousNamesToLookup = functions.database.ref('/admin/add_anon_names').onWrite(event => {
    // Only edit data when it is first created.
    if (event.data.previous.exists()) {
        return;
    }
    // Exit when the data is deleted.
    if (!event.data.exists()) {
        return;
    }


    var updateObject = {};

    for (var i = 0; i < adjectives.length; i++) {

        for (var j = 0; j < animals.length; j++) {
            const name = adjectives[i].toLowerCase() + animals[j].toLowerCase();
            updateObject[`/users/lookup/username/${name}`] = name;
        }
    }

    return database.ref().update(updateObject).then(result => {

    }).catch(function (error) {
        console.log("Promise rejected: " + error);
    });

});

// This HTTPS endpoint can only be accessed by your Firebase Users.
// Requests need to be authorized by providing an `Authorization` HTTP header
// with value `Bearer <Firebase ID Token>`.
exports.app = functions.https.onRequest(app);


Array.prototype.containsAtIndex = function (v) {
    for (var i = 0; i < this.length; i++) {
        if (this[i] === v) return i;
    }
    return null;
};

Array.prototype.unique = function () {
    var arr = [];
    for (var i = 0; i < this.length; i++) {
        const j = arr.containsAtIndex(this[i]);
        if (j !== null) {
            arr.splice(j, 1);
            arr.push(this[i]);
        } else {
            arr.push(this[i]);
        }
    }
    return arr;
};