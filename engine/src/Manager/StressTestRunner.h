#pragma once

#include <QString>

#include <cstddef>
#include <vector>

class Viewport;

//One timed step of a stress test, shown as a row in the stress test panel
struct StressResult {
	QString name;        //e.g. "Load: generate"
	size_t splatCount;   //Splats the step worked on
	double ms;           //Time the step took
};

//Runs the automated stress tests and times them. No UI, the panel only displays what comes back.
//Tests act on the scene of the viewport it is given.
class StressTestRunner {
public:
	explicit StressTestRunner(Viewport* viewport) : m_viewport(viewport) {}

	//Generates a sphere and adds it to the scene, timing each phase.
	//Returns nothing if the renderer is not ready or the scene is full.
	//Phases: generating the splats, handing them to the renderer, and the first frame after
	//(the renderer defers its GPU upload to the next draw, so that frame is where the real load cost is).
	std::vector<StressResult> TestLoad(size_t count);

private:
	Viewport* m_viewport;
};
