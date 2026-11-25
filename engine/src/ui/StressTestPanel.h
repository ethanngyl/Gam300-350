#pragma once

#include "../Manager/StressTestRunner.h"

#include <QList>
#include <QSet>
#include <QStringList>
#include <QWidget>

#include <vector>

class QBrush;
class QLabel;
class QPushButton;
class QSpinBox;
class QTableWidget;

class StressTestPanel : public QWidget {
	Q_OBJECT

public:
	explicit StressTestPanel(QWidget* parent = nullptr);
	~StressTestPanel() override;

	//Appends one row per result to the table, followed by a total row adding them up
	//testName says which test produced them, every test gets its own row color so the rows can be told apart
	//A failed result gets a red row marked FAILED, with a banner above the table until the results are cleared
	//Failed rows are left out of the total
	//Returns the total, the time of all the rows added together in milliseconds
	double AddResults(const std::vector<StressResult>& results, const QString& testName);

	//How many failed rows have been added since the results were last cleared
	int FailedCount() const { return m_failedCount; }

	//Appends a bold, gray total row that belongs to no single test (e.g. the total of a whole Test All run)
	void AddTotal(const QString& label, double ms, const QString& tooltip);

	//How many splats the test sphere is generated with, set by the spin box in the panel
	size_t SplatCount() const;

	//While a test runs the buttons that start tests are disabled
	//Stop is only usable if the run can be stopped (Test All, between tests)
	void SetRunning(bool running, bool stoppable);

	//Singal to run various stress tests
signals:
	void loadTestRequested();
	void selectTestRequested();
	void moveTestRequested();
	void trimTestRequested();
	void exportTestRequested();
	void deleteTestRequested();
	void undoRedoTestRequested();
	void testAllRequested();        //Loads its own test sphere first, then tests that
	void testAllCurrentRequested(); //Skips Load and tests the model that is selected
	void stopRequested();

private:
	//Shows the explanation of the selected row under the table, or a hint if no row is selected
	void ShowSelectedDescription();

	//Appends one row, with the tooltip and color on every cell
	//A failed row is drawn white on the color given (red), and is marked so the description can be drawn red too
	//group says which test's rows it belongs to (-1 for none), isTotal marks the row that collapses and expands the group
	void AppendRow(const QString& name, const QString& splats, const QString& time, const QString& tooltip,
		const QBrush& color, bool bold, bool failed = false, int group = -1, bool isTotal = false);

	//Hides the rows of one test and leaves its total row, or shows them again. Failed rows stay visible either way
	void SetGroupCollapsed(int group, bool collapsed);
	void SetAllGroupsCollapsed(bool collapsed);

	QTableWidget* m_results = nullptr;
	QLabel* m_description = nullptr;
	QLabel* m_failureBanner = nullptr; //Red bar above the table, only visible while there are failed rows
	int m_failedCount = 0;
	int m_nextGroup = 0;              //Each AddResults call is one group, so each test run can be collapsed on its own
	QSet<int> m_collapsedGroups;
	QList<QPushButton*> m_runButtons; //Every button that starts something, disabled while a test runs
	QPushButton* m_stopButton = nullptr;
	QSpinBox* m_splatCount = nullptr; //Splats in the test sphere
	QStringList m_testNames; //Tests in the order they first showed results, the position picks the row color
};
